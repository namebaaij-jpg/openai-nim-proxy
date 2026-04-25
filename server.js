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

const MODEL = "deepseek-ai/deepseek-v4-pro"; // ✅ Default model updated to Pro

// ✅ Rough token estimator (1 token ≈ 4 chars)
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

// ✅ Trim messages to fit within token budget
function trimMessages(messages, maxTokens = 3000) {
  const system = messages.filter(m => m.role === 'system');
  const nonSystem = messages.filter(m => m.role !== 'system');

  // Trim system prompt if too long
  let systemMsg = system[0] || null;
  if (systemMsg && estimateTokens(systemMsg.content) > 1500) {
    console.log("⚠️ System prompt too long, trimming...");
    systemMsg = {
      ...systemMsg,
      content: systemMsg.content.substring(0, 6000) // Cap at ~1500 tokens
    };
  }

  // Keep last 20 chat messages
  const recentMessages = nonSystem.slice(-20);

  // Calculate total tokens used
  let totalTokens = systemMsg ? estimateTokens(systemMsg.content) : 0;
  const finalMessages = [];

  for (const msg of recentMessages) {
    const tokens = estimateTokens(msg.content);
    if (totalTokens + tokens > maxTokens) break;
    finalMessages.push(msg);
    totalTokens += tokens;
  }

  return systemMsg ? [systemMsg, ...finalMessages] : finalMessages;
}

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

    // ✅ Trim system prompt + messages to fit token budget
    const trimmedMessages = trimMessages(messages, 3000);

    console.log("📤 Sending to NIM:", selectedModel, "Messages:", trimmedMessages.length);
    console.log("📊 Estimated tokens:", trimmedMessages.reduce((acc, m) => acc + estimateTokens(m.content), 0));

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
        timeout: 120000
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
