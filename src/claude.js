// claude.js — CLI-first, API-fallback Claude invocation

const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execFileAsync = promisify(execFile);

const CLI_TIMEOUT_MS = parseInt(process.env.CLI_TIMEOUT_MS || '30000', 10);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-6';
const API_FALLBACK_ENABLED = (process.env.API_FALLBACK_ENABLED ?? 'true') === 'true';

/**
 * Escape a string for use inside a PowerShell double-quoted string.
 * Order matters: backticks first (escape char), then dollar signs, then quotes.
 */
function escapePowerShell(str) {
  return str
    .replace(/`/g, '``')     // backticks — PowerShell escape char
    .replace(/\$/g, '`$')    // dollar signs — prevent variable expansion
    .replace(/"/g, '`"');    // double quotes
}

/**
 * Ask Claude a question.
 * Tries the local Claude CLI first (subscription), falls back to Anthropic API.
 *
 * @param {object} opts
 * @param {string} opts.prompt        - The user prompt
 * @param {string} [opts.system]      - Optional system prompt
 * @param {string} [opts.model]       - Model override (defaults to ANTHROPIC_MODEL)
 * @param {object} [opts.jsonSchema]  - JSON Schema to enforce structured output
 * @returns {Promise<{ response: string, source: 'cli'|'api', model: string }>}
 */
async function ask({ prompt, system, model, jsonSchema }) {
  const resolvedModel = model || ANTHROPIC_MODEL;

  // --- Attempt 1: Claude CLI (skipped in container mode — no PowerShell/subscription) ---
  if (process.env.CONTAINER_MODE !== 'true') {
    try {
      // On Windows, claude resolves to claude.cmd which requires a shell to execute.
      // cmd.exe doesn't quote arguments so multi-word prompts get split.
      // PowerShell -EncodedCommand accepts Base64-encoded UTF-16LE commands,
      // completely bypassing quoting issues regardless of prompt content.
      let cliCmd = `claude -p "${escapePowerShell(prompt)}" --model "${escapePowerShell(resolvedModel)}" --bare --no-session-persistence`;
      if (system) cliCmd += ` --append-system-prompt "${escapePowerShell(system)}"`;
      if (jsonSchema) {
        const schemaStr = typeof jsonSchema === 'string' ? jsonSchema : JSON.stringify(jsonSchema);
        cliCmd += ` --output-format json --json-schema "${escapePowerShell(schemaStr)}"`;
      }

      const encoded = Buffer.from(cliCmd, 'utf16le').toString('base64');

      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        {
          timeout: CLI_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
          cwd: os.homedir() // neutral cwd — prevents CLAUDE.md project context from interfering
        }
      );

      const response = stdout.trim();
      if (!response) throw new Error('CLI returned empty response');

      // When --output-format json is used, CLI returns an envelope with structured_output
      if (jsonSchema) {
        try {
          const envelope = JSON.parse(response);
          if (envelope.structured_output) {
            return {
              response: JSON.stringify(envelope.structured_output),
              source: 'cli',
              model: 'subscription'
            };
          }
          // If structured_output is missing, fall through to raw result field
          if (envelope.result) {
            return { response: envelope.result, source: 'cli', model: 'subscription' };
          }
        } catch {
          // JSON parse failed — return raw response
        }
      }

      return { response, source: 'cli', model: 'subscription' };
    } catch (cliErr) {
      const reason = cliErr.killed ? 'timeout' : cliErr.code === 'ENOENT' ? 'not found' : cliErr.message;
      console.warn(`[claude] CLI failed (${reason}), falling back to API`);
    }
  }

  // --- Attempt 2: Anthropic API (feature-flagged) ---
  if (!API_FALLBACK_ENABLED) {
    const err = new Error('CLI unavailable and API fallback is disabled');
    err.code = 'FALLBACK_DISABLED';
    throw err;
  }
  if (!ANTHROPIC_API_KEY) {
    const err = new Error('CLI unavailable and ANTHROPIC_API_KEY is not set');
    err.code = 'FALLBACK_DISABLED';
    throw err;
  }

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
    const errBody = await res.text();
    console.error(`[claude] Anthropic API error ${res.status}:`, errBody);
    throw new Error('Upstream API request failed');
  }

  const data = await res.json();
  const response = data.content?.[0]?.text?.trim();
  if (!response) throw new Error('API returned empty response');

  return { response, source: 'api', model: resolvedModel };
}

module.exports = { ask };
