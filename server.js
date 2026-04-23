const express = require('express');
const cors = require('cors');
const axios = require('axios');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CONFIG =====
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// Realistic safe limits for Render + Janitor
const MAX_CONTEXT_TOKENS = 128000;   // safe usable range
const MIN_OUTPUT_TOKENS = 512;
const MAX_OUTPUT_TOKENS = 4096;

// ===== MIDDLEWARE =====
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// ===== MODEL MAP =====
const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'gpt-4': 'qwen/qwen3-coder-480b-a35b-instruct',
  'gpt-4-turbo': 'moonshotai/kimi-k2-instruct-0905',
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',
  'claude-3-opus': 'openai/gpt-oss-120b',
  'claude-3-sonnet': 'openai/gpt-oss-20b',
  'gemini-pro': 'qwen/qwen3-next-80b-a3b-thinking'
};

// ===== UTIL: Rough token estimate =====
function estimateTokens(obj) {
  return Math.floor(JSON.stringify(obj).length / 4);
}

// ===== UTIL: Trim messages safely =====
function trimMessages(messages, maxTokens = MAX_CONTEXT_TOKENS) {
  let total = 0;
  const trimmed = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const size = estimateTokens(msg);

    if (total + size > maxTokens) break;

    trimmed.unshift(msg);
    total += size;
  }

  return trimmed;
}

// ===== UTIL: Dynamic output tokens =====
function calculateMaxTokens(messages) {
  const inputTokens = estimateTokens(messages);

  const remaining = MAX_CONTEXT_TOKENS - inputTokens;

  return Math.max(
    MIN_OUTPUT_TOKENS,
    Math.min(MAX_OUTPUT_TOKENS, remaining)
  );
}

// ===== HEALTH =====
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    max_context: MAX_CONTEXT_TOKENS
  });
});

// ===== MODELS =====
app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(model => ({
    id: model,
    object: 'model',
    created: Date.now(),
    owned_by: 'nim-proxy'
  }));

  res.json({ object: 'list', data: models });
});

// ===== MAIN ENDPOINT =====
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;

    // ===== MODEL RESOLVE =====
    let nimModel = MODEL_MAPPING[model] || 'deepseek-ai/deepseek-v3.1';

    // ===== TRIM CONTEXT =====
    const safeMessages = trimMessages(messages);

    // ===== TOKEN CONTROL =====
    const safeMaxTokens = max_tokens || calculateMaxTokens(safeMessages);

    // ===== DEBUG LOG =====
    console.log("Incoming size:", JSON.stringify(messages).length);
    console.log("Trimmed tokens:", estimateTokens(safeMessages));
    console.log("Max output:", safeMaxTokens);

    // ===== REQUEST =====
    const nimRequest = {
      model: nimModel,
      messages: safeMessages,
      temperature: temperature || 0.7,
      max_tokens: safeMaxTokens,
      stream: stream || false
    };

    const response = await axios.post(
      `${NIM_API_BASE}/chat/completions`,
      nimRequest,
      {
        headers: {
          'Authorization': `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        responseType: stream ? 'stream' : 'json'
      }
    );

    // ===== STREAM =====
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      response.data.on('data', chunk => {
        res.write(chunk.toString());
      });

      response.data.on('end', () => res.end());
      response.data.on('error', () => res.end());
      return;
    }

    // ===== NORMAL RESPONSE =====
    const openaiResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: response.data.choices.map(choice => ({
        index: choice.index,
        message: {
          role: choice.message.role,
          content: choice.message.content
        },
        finish_reason: choice.finish_reason
      })),
      usage: response.data.usage || {}
    };

    res.json(openaiResponse);

  } catch (error) {
    console.error("ERROR:", error.response?.data || error.message);

    res.status(error.response?.status || 500).json({
      error: {
        message: error.response?.data || error.message,
        code: error.response?.status || 500
      }
    });
  }
});

// ===== FALLBACK =====
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: "Endpoint not found",
      code: 404
    }
  });
});

// ===== START =====
app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`);
});
