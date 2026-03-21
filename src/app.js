// app.js — Express app factory (importable for testing)

const express = require('express');
const { ask } = require('./claude');

function createApp({ gatewayApiKey } = {}) {
  const apiKey = gatewayApiKey || process.env.GATEWAY_API_KEY || '';

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // --- Auth middleware ---
  function requireAuth(req, res, next) {
    if (!apiKey) {
      return res.status(500).json({ error: 'GATEWAY_API_KEY is not set on the server' });
    }
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token !== apiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  // --- Health check (no auth required) ---
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'claude-gateway' });
  });

  // --- Main endpoint ---
  app.post('/ask', requireAuth, async (req, res) => {
    const { prompt, system, model } = req.body || {};

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required and must be a non-empty string' });
    }

    const startMs = Date.now();

    try {
      const result = await ask({ prompt: prompt.trim(), system, model });
      const durationMs = Date.now() - startMs;
      console.log(`[ask] source=${result.source} duration=${durationMs}ms`);
      res.json({ ...result, durationMs });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      console.error(`[ask] error after ${durationMs}ms:`, err.message);
      res.status(502).json({ error: err.message, durationMs });
    }
  });

  return app;
}

module.exports = { createApp };
