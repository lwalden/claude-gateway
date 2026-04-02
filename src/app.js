// app.js — Express app factory (importable for testing)

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const { ask } = require('./claude');
const { log, requestLogger } = require('./logger');

const MAX_PROMPT_LENGTH = 100_000; // ~100K chars — well above normal use, prevents abuse
const MAX_SYSTEM_LENGTH = 100_000;
const MAX_MODEL_LENGTH = 256;

/**
 * Constant-time token comparison using HMAC digests.
 * Normalizes to fixed-length hashes so neither value length nor content leaks via timing.
 */
function tokensMatch(a, b) {
  if (!a || !b) return false;
  const key = crypto.randomBytes(32);
  const hmacA = crypto.createHmac('sha256', key).update(a).digest();
  const hmacB = crypto.createHmac('sha256', key).update(b).digest();
  return crypto.timingSafeEqual(hmacA, hmacB);
}

function createApp({ gatewayApiKey } = {}) {
  const apiKey = gatewayApiKey || process.env.GATEWAY_API_KEY || '';

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);

  // --- Auth middleware (constant-time HMAC comparison) ---
  function requireAuth(req, res, next) {
    if (!apiKey) {
      return res.status(500).json({ error: 'GATEWAY_API_KEY is not set on the server' });
    }
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!tokensMatch(token, apiKey)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  // --- Health check (no auth required) ---
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'claude-gateway' });
  });

  // --- CLI auth health check (no auth required) ---
  app.get('/health/cli', (req, res) => {
    try {
      const credsPath = path.join(os.homedir(), '.claude', '.credentials.json');
      const raw = fs.readFileSync(credsPath, 'utf8');
      const creds = JSON.parse(raw);
      const expiresAt = creds?.claudeAiOauth?.expiresAt;
      if (!expiresAt) {
        return res.json({ status: 'unknown', reason: 'expiresAt not found in credentials' });
      }
      const nowMs = Date.now();
      const hoursRemaining = Math.round((expiresAt - nowMs) / 1000 / 60 / 60 * 10) / 10;
      const status = hoursRemaining <= 0 ? 'expired' : hoursRemaining < 2 ? 'expiring' : 'ok';
      res.json({ status, expiresAt, hoursRemaining });
    } catch (err) {
      res.json({ status: 'unknown', reason: 'could not read credentials file' });
    }
  });

  // --- Main endpoint ---
  app.post('/ask', requireAuth, async (req, res) => {
    const { prompt, system, model, jsonSchema } = req.body || {};

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required and must be a non-empty string' });
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({ error: `prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters` });
    }
    if (system !== undefined && typeof system !== 'string') {
      return res.status(400).json({ error: 'system must be a string if provided' });
    }
    if (typeof system === 'string' && system.length > MAX_SYSTEM_LENGTH) {
      return res.status(400).json({ error: `system exceeds maximum length of ${MAX_SYSTEM_LENGTH} characters` });
    }
    if (model !== undefined && typeof model !== 'string') {
      return res.status(400).json({ error: 'model must be a string if provided' });
    }
    if (typeof model === 'string' && model.length > MAX_MODEL_LENGTH) {
      return res.status(400).json({ error: `model exceeds maximum length of ${MAX_MODEL_LENGTH} characters` });
    }
    if (jsonSchema !== undefined && typeof jsonSchema !== 'object') {
      return res.status(400).json({ error: 'jsonSchema must be an object if provided' });
    }

    const startMs = Date.now();

    try {
      const result = await ask({ prompt: prompt.trim(), system, model, jsonSchema });
      const durationMs = Date.now() - startMs;
      console.log(`[ask] source=${result.source} duration=${durationMs}ms`);
      res._logMeta = { source: result.source, model: result.model };
      res.json({ ...result, durationMs });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const safeMessage = sanitizeErrorMessage(err.message);
      console.error(`[ask] error after ${durationMs}ms:`, safeMessage);
      res._logMeta = { error: safeMessage };
      res.status(502).json({ error: safeMessage, durationMs });
    }
  });

  // --- JSON 404 for unregistered routes ---
  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
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
    'CLI unavailable and ANTHROPIC_API_KEY is not set',
    'CLI unavailable and API fallback is disabled',
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
