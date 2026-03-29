// claude-gateway — local HTTP service for CLI-first, API-fallback Claude access

const path = require('path');

// Load .env from project root (same directory as package.json)
try {
  const envPath = path.join(__dirname, '..', '.env');
  require('fs').readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const match = line.match(/^\s*([^#][^=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] ??= match[2].trim();
  });
} catch { /* no .env — rely on process environment */ }

const { createApp } = require('./app');

const PORT = parseInt(process.env.PORT || '3131', 10);
const app = createApp();

// --- Start ---
app.listen(PORT, () => {
  console.log(`claude-gateway listening on port ${PORT}`);
  console.log(`  Auth:     ${process.env.GATEWAY_API_KEY ? 'enabled' : 'MISSING — set GATEWAY_API_KEY'}`);
  console.log(`  CLI:      claude --print`);
  console.log(`  Fallback: Anthropic API (${process.env.ANTHROPIC_MODEL || 'claude-opus-4-6'})`);
});
