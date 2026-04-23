const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// NVIDIA NIM API configuration
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// 🔥 128K CONTEXT SETTINGS
const MAX_CONTEXT = 128000;
const SAFETY_BUFFER = 8000;

// Reasoning toggles
const SHOW_REASONING = false;
const ENABLE_THINKING_MODE = false;

// Model mapping
const MODEL_MAPPING = {
  'gpt-3.5-turbo': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'gpt-4': 'qwen/qwen3-coder-480b-a35b-instruct',
  'gpt-4-turbo': 'moonshotai/kimi-k2-instruct-0905',
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',
  'claude-3-opus': 'openai/gpt-oss-120b',
  'claude-3-sonnet': 'openai/gpt-oss-20b',
  'gemini-pro': 'qwen/qwen3-next-80b-a3b-thinking'
};

// ===== TOKEN ESTIMATE (safe approximation) =====
function estimateTokens(messages) {
  return Math.floor(JSON.stringify(messages).length / 4);
}

// ===== TRIM CONTEXT (IMPORTANT FIX) =====
function trimMessages(messages) {
  if (!Array.isArray(messages)) return [];

  let total = 0;
  const result = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const size = estimateTokens([msg]);

    if (total + size > MAX_CONTEXT - SAFETY_BUFFER) break;

    result.unshift(msg);
    total += size;
  }

  return result;
}

// Health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    max_context: MAX_CONTEXT
  });
});

// Models
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: Object.keys(MODEL_MAPPING).map(m => ({
      id: m,
      object: 'model'
    }))
  });
});

// Chat endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    let { model, messages, temperature, max_tokens, stream } = req.body;

    const nimModel = MODEL_MAPPING[model] || MODEL_MAPPING['gpt-4o'];

    // 🔥 TRIM MESSAGES FOR 128K SAFETY
    const safeMessages = trimMessages(messages);

    // 🔥 SAFE MAX TOKENS (important)
    const safeMaxTokens = Math.min(
      max_tokens || 4096,
      8192
    );

    const nimRequest = {
      model: nimModel,
      messages: safeMessages,
      temperature: temperature || 0.7,
      max_tokens: safeMaxTokens,
      stream: stream || false,
      extra_body: ENABLE_THINKING_MODE
        ? { chat_template_kwargs: { thinking: true } }
        : undefined
    };

    const response = await axios.post(
      `${NIM_API_BASE}/chat/completions`,
      nimRequest,
      {
        headers: {
          Authorization: `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        },
        responseType: stream ? 'stream' : 'json'
      }
    );

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');

      response.data.on('data', chunk => res.write(chunk.toString()));
      response.data.on('end', () => res.end());

      return;
    }

    const choice = response.data?.choices?.[0];

    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: choice?.message?.content || ''
          },
          finish_reason: choice?.finish_reason || 'stop'
        }
      ],
      usage: response.data?.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    });

  } catch (error) {
    console.error('Proxy error:', error.message);

    res.status(500).json({
      error: {
        message: error.message,
        type: 'proxy_error'
      }
    });
  }
});

// Catch-all
app.all('*', (req, res) => {
  res.status(404).json({
    error: { message: 'Not found' }
  });
});

app.listen(PORT, () => {
  console.log(`🔥 128K SAFE PROXY running on port ${PORT}`);
});
