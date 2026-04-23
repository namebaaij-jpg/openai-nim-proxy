const express = require('express');
const cors = require('cors');
const axios = require('axios');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CONFIG =====
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// 🔥 128K TARGET
const MAX_CONTEXT = 128000;
const SAFETY_BUFFER = 8000; // reserve for output + system overhead

const MIN_OUTPUT = 512;
const MAX_OUTPUT = 8192;

// ===== MIDDLEWARE =====
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ===== MODEL MAP (force large-context models) =====
const MODEL_MAPPING = {
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',
  'gpt-4-turbo': 'moonshotai/kimi-k2-instruct-0905',
  'gpt-4': 'qwen/qwen3-coder-480b-a35b-instruct'
};

// ===== TOKEN ESTIMATION =====
function estimateTokens(obj) {
  return Math.floor(JSON.stringify(obj).length / 4);
}

// ===== HARD TRIM (128K SAFE) =====
function trimMessages(messages) {
  const maxInputTokens = MAX_CONTEXT - SAFETY_BUFFER;

  let total = 0;
  const trimmed = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const size = estimateTokens(msg);

    if (total + size > maxInputTokens) break;

    trimmed.unshift(msg);
    total += size;
  }

  return trimmed;
}

// ===== DYNAMIC OUTPUT =====
function calculateMaxTokens(messages) {
  const inputTokens = estimateTokens(messages);

  const remaining = MAX_CONTEXT - inputTokens;

  return Math.max(
    MIN_OUTPUT,
    Math.min(MAX_OUTPUT, remaining - 1000)
  );
}

// ===== HEALTH =====
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: '128k-attempt',
    max_context: MAX_CONTEXT
  });
});

// ===== MAIN =====
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;

    const nimModel = MODEL_MAPPING[model] || 'deepseek-ai/deepseek-v3.1';

    // 🔥 TRIM FOR 128K
    const safeMessages = trimMessages(messages);

    const inputTokens = estimateTokens(safeMessages);
    const safeMaxTokens = max_tokens || calculateMaxTokens(safeMessages);

    // ===== DEBUG =====
    console.log("RAW size:", JSON.stringify(messages).length);
    console.log("INPUT tokens:", inputTokens);
    console.log("OUTPUT tokens:", safeMaxTokens);
    console.log("TOTAL:", inputTokens + safeMaxTokens);

    // 🚨 HARD FAIL GUARD
    if (inputTokens + safeMaxTokens > MAX_CONTEXT) {
      return res.status(400).json({
        error: "Context overflow even after trimming"
      });
    }

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
        timeout: 60000,
        responseType: stream ? 'stream' : 'json'
      }
    );

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      response.data.on('data', chunk => res.write(chunk.toString()));
      response.data.on('end', () => res.end());
      return;
    }

    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: response.data.choices,
      usage: response.data.usage || {}
    });

  } catch (error) {
    console.error("ERROR:", error.response?.data || error.message);

    res.status(error.response?.status || 500).json({
      error: error.response?.data || error.message
    });
  }
});

// ===== START =====
app.listen(PORT, () => {
  console.log(`🔥 128K proxy running on ${PORT}`);
});
