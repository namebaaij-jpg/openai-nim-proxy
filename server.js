const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ CORS FIX
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());

// Body parser
app.use(express.json({ limit: '100mb' }));

// NVIDIA config
const NIM_API_BASE = 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// ✅ All available models
const MODELS = {
  "z-ai/glm-5.1": "z-ai/glm-5.1",
  "z-ai/glm-4.7": "z-ai/glm-4.7",
  "deepseek-ai/deepseek-v4-flash": "deepseek-ai/deepseek-v4-flash",
  "deepseek-ai/deepseek-v4-pro": "deepseek-ai/deepseek-v4-pro"
};

const MODEL = "z-ai/glm-5.1"; // Default model

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.send('✅ Proxy is running');
});

// ===== DEBUG: LIST AVAILABLE NVIDIA MODELS =====
app.get('/debug/models', async (req, res) => {
  try {
    const response = await axios.get(`${NIM_API_BASE}/models`, {
      headers: {
        Authorization: `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// ===== MODELS (REQUIRED FOR JANITOR) =====
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: Object.keys(MODELS).map(id => ({
      id: id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'nvidia'
    }))
  });
});

// ===== CHAT =====
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, temperature, max_tokens, model } = req.body;

    const selectedModel = MODELS[model] || MODEL;

    // ✅ Trim to last 20 messages to avoid context overflow
    const trimmedMessages = messages.slice(-20);

    console.log("📤 Sending to NIM:", selectedModel, "Messages:", trimmedMessages.length);

    const response = await axios.post(
      `${NIM_API_BASE}/chat/completions`,
      {
        model: selectedModel,
        messages: trimmedMessages,
        temperature: temperature || 0.8,
        max_tokens: Math.min(max_tokens || 1024, 4096),
        stream: false
      },
      {
        headers: {
          Authorization: `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000 // ✅ 2 minute timeout
      }
    );

    const choice = response.data?.choices?.[0];
    const content = choice?.message?.content;

    // ✅ Catch empty responses before sending to Janitor
    if (!content || content.trim() === '') {
      return res.status(500).json({
        error: {
          message: 'Model returned empty response',
          type: 'empty_response'
        }
      });
    }

    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: selectedModel,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: content
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
    console.error("❌ ERROR:", error.response?.data || error.message);
    res.status(500).json({
      error: {
        message: error.response?.data?.detail || error.message,
        type: 'proxy_error'
      }
    });
  }
});

// ===== 404 =====
app.all('*', (req, res) => {
  res.status(404).json({ error: { message: 'Not found' } });
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`🔥 Proxy running on port ${PORT}`);
});
