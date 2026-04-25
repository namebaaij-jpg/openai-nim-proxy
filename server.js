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

// ✅ FIXED: Valid NVIDIA NIM model ID
const MODEL = "zhipuai/glm-4-9b-chat";

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.send('✅ Proxy is running');
});

// ===== MODELS =====
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: MODEL,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'nvidia'
      }
    ]
  });
});

// ===== CHAT =====
// ✅ FIXED: app.post was corrupted to [app.post](http://app.post)
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, temperature, max_tokens } = req.body;

    // ✅ FIXED: axios.post was corrupted to [axios.post](http://axios.post)
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
        },
        timeout: 60000
      }
    );

    // ✅ FIXED: response.data was corrupted to [response.data](http://response.data)
    const choice = response.data?.choices?.[0];

    res.json({
      // ✅ FIXED: Date.now was corrupted to [Date.now](http://Date.now)
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: MODEL,
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
      // ✅ ADDED: usage block expected by many frontends
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

// START SERVER
app.listen(PORT, () => {
  console.log(`🔥 Proxy running on port ${PORT}`);
});
