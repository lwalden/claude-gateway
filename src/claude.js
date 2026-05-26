// claude.js — CLI-first, API-fallback Claude invocation

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
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
    // Write prompt to a temp file and pipe it to claude via Get-Content.
    // This avoids PowerShell's 32KB command-line limit for -EncodedCommand,
    // which large batch prompts (e.g. AccessiShield remediation) exceed.
    const tmpFile = path.join(os.tmpdir(), `claude-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    try {
      fs.writeFileSync(tmpFile, prompt, 'utf8');

      // Do NOT add --bare: it forces ANTHROPIC_API_KEY/apiKeyHelper auth and never
      // reads the OAuth subscription (per `claude --help`), which silently defeats
      // the CLI-first subscription path. See DECISIONS.md.
      let cliCmd = `Get-Content "${tmpFile}" -Raw | claude -p --model "${escapePowerShell(resolvedModel)}" --no-session-persistence`;
      if (system) cliCmd += ` --append-system-prompt "${escapePowerShell(system)}"`;
      if (jsonSchema) {
        const schemaStr = typeof jsonSchema === 'string' ? jsonSchema : JSON.stringify(jsonSchema);
        cliCmd += ` --json-schema "${escapePowerShell(schemaStr)}"`;
      }

      const encoded = Buffer.from(cliCmd, 'utf16le').toString('base64');

      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        {
          timeout: CLI_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
          cwd: os.homedir(),
          input: ''
        }
      );

      const response = stdout.trim();
      if (!response) throw new Error('CLI returned empty response');

      return { response, source: 'cli', model: 'subscription' };
    } catch (cliErr) {
      const reason = cliErr.killed ? 'timeout' : cliErr.code === 'ENOENT' ? 'not found' : cliErr.message;
      console.warn(`[claude] CLI failed (${reason}), falling back to API`);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
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
  if (jsonSchema) {
    body.tools = [{
      name: 'structured_output',
      description: 'Return the response in this exact JSON structure',
      input_schema: jsonSchema
    }];
    body.tool_choice = { type: 'tool', name: 'structured_output' };
  }

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
    // Prefix with "Anthropic API error <status>" so app.js's sanitizeErrorMessage
    // surfaces the upstream status to the caller as "Upstream API error (status N)".
    // The raw body is logged above but is stripped from the caller-facing message.
    throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  let response;
  if (jsonSchema && data.content) {
    // tool_use response: find the tool_use block and extract its input
    const toolBlock = data.content.find(b => b.type === 'tool_use');
    response = toolBlock ? JSON.stringify(toolBlock.input) : data.content[0]?.text?.trim();
  } else {
    response = data.content?.[0]?.text?.trim();
  }
  if (!response) throw new Error('API returned empty response');

  return { response, source: 'api', model: resolvedModel };
}

module.exports = { ask };
