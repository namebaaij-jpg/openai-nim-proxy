const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ CORS FIX (VERY IMPORTANT FOR JANITOR)
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

// 🔥 FORCE MODEL (NO MAPPING)
const MODEL = "z-ai/glm5.1";

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.send('✅ Proxy is running');
});

// ===== MODELS (REQUIRED FOR JANITOR) =====
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: MODEL,
        object: 'model'
      }
    ]
  });
});

// ===== CHAT =====
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, temperature, max_tokens, stream } = req.body;

    const response = await axios.post(
      `${NIM_API_BASE}/chat/completions`,
      {
        model: MODEL,
        messages: messages,
        temperature: temperature || 0.8,
        max_tokens: Math.min(max_tokens || 1024, 8192),
        stream: false
      },
      {
        headers: {
          Authorization: `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const choice = response.data?.choices?.[0];

    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: choice?.message?.content || ''
          },
          finish_reason: 'stop'
        }
      ]
    });

  } catch (error) {
    console.error("❌ ERROR:", error.response?.data || error.message);

    res.status(500).json({
      error: {
        message: error.response?.data || error.message,
        type: 'proxy_error'
      }
    });
  }
});

// ===== 404 =====
app.all('*', (req, res) => {
  res.status(404).json({
    error: { message: 'Not found' }
  });
});

// START SERVER
app.listen(PORT, () => {
  console.log(`🔥 Proxy running on port ${PORT}`);
});
