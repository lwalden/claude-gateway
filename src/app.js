// app.js — Express app factory (importable for testing)

const crypto = require('crypto');
const express = require('express');
const { ask } = require('./claude');

const MAX_PROMPT_LENGTH = 100_000; // ~100K chars — well above normal use, prevents abuse

function createApp({ gatewayApiKey } = {}) {
  const apiKey = gatewayApiKey || process.env.GATEWAY_API_KEY || '';

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // --- Auth middleware (timing-safe comparison) ---
  function requireAuth(req, res, next) {
    if (!apiKey) {
      return res.status(500).json({ error: 'GATEWAY_API_KEY is not set on the server' });
    }
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || token.length !== apiKey.length ||
        !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(apiKey))) {
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
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({ error: `prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters` });
    }
    if (system !== undefined && typeof system !== 'string') {
      return res.status(400).json({ error: 'system must be a string if provided' });
    }
    if (model !== undefined && typeof model !== 'string') {
      return res.status(400).json({ error: 'model must be a string if provided' });
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
      // Sanitize: don't forward raw API error bodies to caller
      const safeMessage = sanitizeErrorMessage(err.message);
      res.status(502).json({ error: safeMessage, durationMs });
    }
  });

  return app;
}

function sanitizeErrorMessage(message) {
  // Strip Anthropic API response bodies (may contain internal details)
  if (message.startsWith('Anthropic API error')) {
    const statusMatch = message.match(/^Anthropic API error (\d+)/);
    return statusMatch
      ? `Upstream API error (status ${statusMatch[1]})`
      : 'Upstream API error';
  }
  // Pass through known safe messages
  const safeMessages = [
    'Claude CLI unavailable and ANTHROPIC_API_KEY is not set',
    'CLI returned empty response',
    'API returned empty response'
  ];
  for (const safe of safeMessages) {
    if (message.includes(safe)) return message;
  }
  // Generic fallback for unexpected errors
  return 'An internal error occurred while processing your request';
}

module.exports = { createApp };

module.exports = { createApp };
