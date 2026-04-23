const express = require('express');
const cors = require('cors');
const axios = require('axios');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CONFIG =====
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// ===== LIMITS (REALISTIC 128K SAFE MODE) =====
const MAX_CONTEXT = 128000;
const SAFETY_BUFFER = 10000;
const MIN_OUTPUT = 512;
const MAX_OUTPUT = 8192;

// ===== MIDDLEWARE =====
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ===== MODEL MAP =====
const MODEL_MAPPING = {
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',
  'gpt-4-turbo': 'moonshotai/kimi-k2-instruct-0905',
  'gpt-4': 'qwen/qwen3-coder-480b-a35b-instruct'
};

// ===== TOKEN ESTIMATE =====
function estimateTokens(obj) {
  return Math.floor(JSON.stringify(obj).length / 4);
}

// ===== TRIM CONTEXT =====
function trimMessages(messages) {
  const maxInput = MAX_CONTEXT - SAFETY_BUFFER;

  let total = 0;
  const out = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const size = estimateTokens(messages[i]);

    if (total + size > maxInput) break;

    out.unshift(messages[i]);
    total += size;
  }

  return out;
}

// ===== OUTPUT TOKENS =====
function calcMaxTokens(messages) {
  const input = estimateTokens(messages);
  const remaining = MAX_CONTEXT - input;

  return Math.max(
    MIN_OUTPUT,
    Math.min(MAX_OUTPUT, remaining - 1000)
  );
}

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
  res.json({ status: 'ok', context: MAX_CONTEXT });
});

// ===== MAIN ENDPOINT =====
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens } = req.body;

    const nimModel = MODEL_MAPPING[model] || 'deepseek-ai/deepseek-v3.1';

    const safeMessages = trimMessages(messages);
    const inputTokens = estimateTokens(safeMessages);
    const safeMaxTokens = max_tokens || calcMaxTokens(safeMessages);

    console.log("INPUT TOKENS:", inputTokens);
    console.log("OUTPUT TOKENS:", safeMaxTokens);

    // safety guard
    if (inputTokens + safeMaxTokens > MAX_CONTEXT) {
      return res.status(400).json({
        error: {
          message: "Context too large",
          type: "invalid_request_error"
        }
      });
    }

    const response = await axios.post(
      `${NIM_API_BASE}/chat/completions`,
      {
        model: nimModel,
        messages: safeMessages,
        temperature: temperature || 0.7,
        max_tokens: safeMaxTokens,
        stream: false   // 🔥 IMPORTANT FIX
      },
      {
        headers: {
          Authorization: `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 60000
      }
    );

    // ===== FIXED OPENAI FORMAT (JANITOR SAFE) =====
    const content =
      response.data?.choices?.[0]?.message?.content ||
      response.data?.choices?.[0]?.text ||
      "";

    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model || "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: content
          },
          finish_reason: "stop"
        }
      ]
    });

  } catch (err) {
    console.error(err.response?.data || err.message);

    res.status(500).json({
      error: {
        message: err.response?.data?.error?.message || err.message,
        type: "proxy_error"
      }
    });
  }
});

// ===== 404 =====
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ===== START =====
app.listen(PORT, () => {
  console.log(`🔥 Proxy running on ${PORT}`);
});
