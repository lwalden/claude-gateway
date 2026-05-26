// claude.js — Claude invocation via the local CLI (OAuth subscription only).
// There is NO Anthropic API-key path: the gateway uses the Claude subscription
// exclusively. See DECISIONS.md ("Subscription-only — no API key").

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execFileAsync = promisify(execFile);

const CLI_TIMEOUT_MS = parseInt(process.env.CLI_TIMEOUT_MS || '30000', 10);
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-6';

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
 * Ask Claude a question via the local Claude CLI (OAuth subscription).
 *
 * @param {object} opts
 * @param {string} opts.prompt        - The user prompt
 * @param {string} [opts.system]      - Optional system prompt
 * @param {string} [opts.model]       - Model override (defaults to ANTHROPIC_MODEL)
 * @param {object} [opts.jsonSchema]  - JSON Schema to enforce structured output
 * @returns {Promise<{ response: string, source: 'cli', model: string }>}
 * @throws {Error} with a caller-safe message if the CLI fails or returns nothing.
 *                 There is no API fallback.
 */
async function ask({ prompt, system, model, jsonSchema }) {
  const resolvedModel = model || DEFAULT_MODEL;

  // Write the prompt to a temp file and pipe it to claude via Get-Content. This
  // avoids PowerShell's 32KB command-line limit for -EncodedCommand, which large
  // batch prompts (e.g. AccessiShield remediation) exceed.
  const tmpFile = path.join(os.tmpdir(), `claude-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  try {
    fs.writeFileSync(tmpFile, prompt, 'utf8');

    // Do NOT add --bare: it forces ANTHROPIC_API_KEY/apiKeyHelper auth and never
    // reads the OAuth subscription (per `claude --help`), defeating the whole point.
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
  } catch (err) {
    // Map to a caller-safe message; log the underlying detail server-side only.
    let safe;
    if (err.message === 'CLI returned empty response') safe = err.message;
    else if (err.killed) safe = 'CLI invocation timed out';
    else if (err.code === 'ENOENT') safe = 'claude CLI not found';
    else safe = 'CLI invocation failed';
    console.error(`[claude] ${safe}:`, err.message);
    throw new Error(safe);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

module.exports = { ask };
