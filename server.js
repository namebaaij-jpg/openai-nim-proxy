const express = require('express');
const cors = require('cors');
const axios = require('axios');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

const NIM_API_BASE = 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

app.use(cors());
app.use(compression());
app.use(express.json({ limit: '50mb' }));

// ===== MODEL PRIORITY LIST =====
const MODELS = [
  'z-ai/glm-5.1',                         // TRY FIRST (may 410)
  'deepseek-ai/deepseek-v3.1',           // SAFE
  'qwen/qwen3-coder-480b-a35b-instruct'  // SAFE
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
          message: "Invalid messages format",
          type: "invalid_request_error"
        }
      });
    }

    let lastError = null;

    // ===== TRY MODELS IN ORDER =====
    for (const model of MODELS) {
      try {
        console.log("Trying model:", model);

        const response = await axios.post(
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
            timeout: 60000
          }
        );

        const content =
          response.data?.choices?.[0]?.message?.content ||
          response.data?.choices?.[0]?.text ||
          "";

        return res.json({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content
              },
              finish_reason: "stop"
            }
          ]
        });

      } catch (err) {
        console.log(`Model failed: ${model}`, err.response?.status || err.message);
        lastError = err;
        continue;
      }
    }

    // ===== ALL FAILED =====
    return res.status(500).json({
      error: {
        message: "All models failed",
        detail: lastError?.message || "Unknown error"
      }
    });

  } catch (err) {
    return res.status(500).json({
      error: {
        message: err.message,
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
  console.log(`🔥 GLM-5.1 fallback proxy running on port ${PORT}`);
});
