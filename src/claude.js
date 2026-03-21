// claude.js — CLI-first, API-fallback Claude invocation

const { spawn } = require('child_process');
const os = require('os');

const CLI_TIMEOUT_MS = parseInt(process.env.CLI_TIMEOUT_MS || '30000', 10);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-6';

/**
 * Invoke Claude CLI by piping the prompt via stdin.
 * Avoids interpolating user input into a command string (prevents injection).
 * Uses cmd.exe /c to resolve claude.cmd, with prompt delivered safely via stdin.
 */
function invokeCli({ prompt, system }) {
  return new Promise((resolve, reject) => {
    const args = ['/c', 'claude', '-p', '-'];
    if (system) args.push('--append-system-prompt', system);

    const child = spawn('cmd.exe', args, {
      timeout: CLI_TIMEOUT_MS,
      cwd: os.homedir(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    const chunks = [];
    let stderrData = '';
    let totalBytes = 0;
    const MAX_OUTPUT = 10 * 1024 * 1024;

    child.stdout.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes <= MAX_OUTPUT) chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => { stderrData += chunk.toString(); });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        const err = new Error('CLI timeout');
        err.killed = true;
        return reject(err);
      }
      if (code !== 0) {
        return reject(new Error(stderrData.trim() || `CLI exited with code ${code}`));
      }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    // Pipe prompt via stdin — no shell interpolation
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Ask Claude a question.
 * Tries the local Claude CLI first (subscription), falls back to Anthropic API.
 *
 * @param {object} opts
 * @param {string} opts.prompt        - The user prompt
 * @param {string} [opts.system]      - Optional system prompt
 * @param {string} [opts.model]       - Model override (API fallback only)
 * @returns {Promise<{ response: string, source: 'cli'|'api', model: string }>}
 */
async function ask({ prompt, system, model }) {
  // --- Attempt 1: Claude CLI (prompt piped via stdin, not interpolated) ---
  try {
    const stdout = await invokeCli({ prompt, system });
    const response = stdout.trim();
    if (!response) throw new Error('CLI returned empty response');

    return { response, source: 'cli', model: 'subscription' };
  } catch (cliErr) {
    const reason = cliErr.killed ? 'timeout' : cliErr.code === 'ENOENT' ? 'not found' : cliErr.message;
    console.warn(`[claude] CLI failed (${reason}), falling back to API`);
  }

  // --- Attempt 2: Anthropic API ---
  if (!ANTHROPIC_API_KEY) {
    throw new Error('Claude CLI unavailable and ANTHROPIC_API_KEY is not set — cannot fulfill request');
  }

  const resolvedModel = model || ANTHROPIC_MODEL;

  const body = {
    model: resolvedModel,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }]
  };
  if (system) body.system = system;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const response = data.content?.[0]?.text?.trim();
  if (!response) throw new Error('API returned empty response');

  return { response, source: 'api', model: resolvedModel };
}

module.exports = { ask };
