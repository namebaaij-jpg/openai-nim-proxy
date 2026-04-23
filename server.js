const express = require('express');
const cors = require('cors');
const axios = require('axios');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CONFIG =====
const NIM_API_BASE = 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// ===== MIDDLEWARE =====
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '50mb' }));

// ===== FAST + STABLE MODELS ONLY =====
const MODELS = [
  'deepseek-ai/deepseek-v3.1',
  'qwen/qwen3-coder-480b-a35b-instruct'
  // ⚠️ GLM REMOVED intentionally (it was causing hangs/410/timeout)
];

// ===== HEALTH =====
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    models: MODELS
  });
});

// ===== MAIN ENDPOINT =====
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, temperature, max_tokens } = req.body;

    if (!Array.isArray(messages)) {
      return res.status(400).json({
        error: {
          message: "Invalid messages format"
        }
      });
    }

    // ===== RUN MODELS IN PARALLEL (🔥 FIXES TIMEOUT ISSUE) =====
    const requests = MODELS.map(model =>
      axios.post(
        `${NIM_API_BASE}/chat/completions`,
        {
          model,
          messages,
          temperature: temperature || 0.7,
          max_tokens: max_tokens || 4096,
          stream: false
        },
        {
          headers: {
            Authorization: `Bearer ${NIM_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000 // fast fail
        }
      ).then(res => ({
        model,
        content: res.data?.choices?.[0]?.message?.content
      })).catch(() => null)
    );

    // ===== WAIT FOR FIRST SUCCESS ONLY =====
    const results = await Promise.all(requests);
    const success = results.find(r => r && r.content);

    if (!success) {
      return res.status(500).json({
        error: {
          message: "No models responded"
        }
      });
    }

    return res.json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: success.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: success.content
          },
          finish_reason: "stop"
        }
      ]
    });

  } catch (err) {
    return res.status(500).json({
      error: {
        message: err.message
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
  console.log(`🔥 Stable Janitor Proxy running on port ${PORT}`);
});
