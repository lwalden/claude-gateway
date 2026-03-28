// claude-gateway — local HTTP service for CLI-first, API-fallback Claude access

const crypto = require('crypto');
const express = require('express');
const { ask } = require('./claude');

// Load .env from project root (same directory as package.json)
const path = require('path');
try {
  const envPath = path.join(__dirname, '..', '.env');
  require('fs').readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const match = line.match(/^\s*([^#][^=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] ??= match[2].trim();
  });
} catch { /* no .env — rely on process environment */ }

const PORT = parseInt(process.env.PORT || '3131', 10);
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY || '';

const app = express();
app.use(express.json({ limit: '1mb' }));

// --- Auth middleware (constant-time comparison) ---
function requireAuth(req, res, next) {
  if (!GATEWAY_API_KEY) {
    return res.status(500).json({ error: 'GATEWAY_API_KEY is not set on the server' });
  }
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const tokenBuf = Buffer.from(token);
  const keyBuf = Buffer.from(GATEWAY_API_KEY);
  if (tokenBuf.length !== keyBuf.length || !crypto.timingSafeEqual(tokenBuf, keyBuf)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// --- Health check (no auth required) ---
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'claude-gateway' });
});

// --- Main endpoint ---
// POST /ask
// Body: { prompt: string, system?: string, model?: string }
// Response: { response: string, source: "cli"|"api", model: string }
app.post('/ask', requireAuth, async (req, res) => {
  const { prompt, system, model } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required and must be a non-empty string' });
  }
  if (prompt.length > 100_000) {
    return res.status(400).json({ error: 'prompt exceeds maximum length (100,000 characters)' });
  }
  if (system !== undefined && (typeof system !== 'string' || system.length > 10_000)) {
    return res.status(400).json({ error: 'system must be a string under 10,000 characters' });
  }
  if (model !== undefined && (typeof model !== 'string' || model.length > 100 || !/^[a-zA-Z0-9._-]+$/.test(model))) {
    return res.status(400).json({ error: 'model must be alphanumeric (with hyphens/dots) and under 100 characters' });
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
    if (err.code === 'FALLBACK_DISABLED') {
      res.status(503).json({ error: 'Claude CLI unavailable', durationMs });
    } else {
      res.status(502).json({ error: 'Upstream service error', durationMs });
    }
  }
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`claude-gateway listening on port ${PORT}`);
  console.log(`  Auth:     ${GATEWAY_API_KEY ? 'enabled' : 'MISSING — set GATEWAY_API_KEY'}`);
  console.log(`  CLI:      claude --print`);
  console.log(`  Fallback: Anthropic API (${process.env.ANTHROPIC_MODEL || 'claude-opus-4-6'})`);
});
