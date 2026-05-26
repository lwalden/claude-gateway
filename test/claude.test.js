// execFile mock — must support util.promisify via [custom] symbol
const { promisify } = require('util');
const mockExecFile = jest.fn();
mockExecFile[promisify.custom] = jest.fn();
jest.mock('child_process', () => ({
  execFile: mockExecFile
}));

// fs mock — only writeFileSync/unlinkSync (temp file for prompt piping)
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    writeFileSync: jest.fn(),
    unlinkSync: jest.fn()
  };
});
const fs = require('fs');

// Set env defaults for tests (subscription-only — no ANTHROPIC_API_KEY)
process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

const { ask } = require('../src/claude');

// The promisified version is what claude.js actually calls
const mockExecFileAsync = mockExecFile[promisify.custom];

function mockCliSuccess(stdout = 'Hello from CLI\n') {
  mockExecFileAsync.mockResolvedValue({ stdout, stderr: '' });
}

function mockCliFailure({ error, stderr = '' } = {}) {
  const err = error || new Error('CLI failed');
  err.stderr = stderr;
  mockExecFileAsync.mockRejectedValue(err);
}

function mockCliTimeout() {
  const err = new Error('Process timed out');
  err.killed = true;
  mockExecFileAsync.mockRejectedValue(err);
}

beforeEach(() => {
  jest.clearAllMocks();
  // Restore the custom symbol after clearAllMocks
  mockExecFile[promisify.custom] = mockExecFileAsync;
});

describe('ask() — CLI path (OAuth subscription)', () => {
  test('returns CLI response with source "cli" on success', async () => {
    mockCliSuccess('Hello from CLI\n');

    const result = await ask({ prompt: 'test prompt' });
    expect(result).toEqual({
      response: 'Hello from CLI',
      source: 'cli',
      model: 'subscription'
    });
    expect(mockExecFileAsync).toHaveBeenCalled();
  });

  test('calls powershell.exe with -EncodedCommand', async () => {
    mockCliSuccess('response');

    await ask({ prompt: 'test' });
    const [cmd, args] = mockExecFileAsync.mock.calls[0];
    expect(cmd).toBe('powershell.exe');
    expect(args).toContain('-EncodedCommand');
  });

  test('does NOT pass --bare (which would disable OAuth) but keeps --no-session-persistence', async () => {
    mockCliSuccess('response');

    await ask({ prompt: 'test' });
    const [, args] = mockExecFileAsync.mock.calls[0];
    const decoded = Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
    // --bare forces ANTHROPIC_API_KEY-only auth and never reads the OAuth
    // subscription, silently defeating the CLI-first path. It must never appear.
    expect(decoded).not.toContain('--bare');
    expect(decoded).toContain('--no-session-persistence');
  });

  test('encodes system prompt into CLI command when provided', async () => {
    mockCliSuccess('response');

    await ask({ prompt: 'test', system: 'be helpful' });
    const [, args] = mockExecFileAsync.mock.calls[0];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toContain('--append-system-prompt');
    expect(decoded).toContain('be helpful');
  });

  test('does not include system flag when system is not provided', async () => {
    mockCliSuccess('response');

    await ask({ prompt: 'test' });
    const [, args] = mockExecFileAsync.mock.calls[0];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).not.toContain('--append-system-prompt');
  });

  test('includes --model flag with caller-specified model', async () => {
    mockCliSuccess('response');

    await ask({ prompt: 'test', model: 'claude-sonnet-4-6' });
    const [, args] = mockExecFileAsync.mock.calls[0];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toContain('--model');
    expect(decoded).toContain('claude-sonnet-4-6');
  });

  test('includes --model flag with default model when none specified', async () => {
    mockCliSuccess('response');

    await ask({ prompt: 'test' });
    const [, args] = mockExecFileAsync.mock.calls[0];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toContain('--model');
    expect(decoded).toContain('claude-sonnet-4-20250514'); // ANTHROPIC_MODEL env
  });

  test('writes prompt to temp file and pipes via Get-Content', async () => {
    mockCliSuccess('response');

    await ask({ prompt: 'test prompt content' });

    // Prompt written to temp file as-is (no PowerShell escaping needed)
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [tmpPath, content, encoding] = fs.writeFileSync.mock.calls[0];
    expect(content).toBe('test prompt content');
    expect(encoding).toBe('utf8');
    expect(tmpPath).toMatch(/claude-prompt-.*\.txt$/);

    // Command uses Get-Content pipe, prompt is NOT in the command
    const [, args] = mockExecFileAsync.mock.calls[0];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toContain('Get-Content');
    expect(decoded).toContain('| claude -p');
    expect(decoded).not.toContain('test prompt content');
  });

  test('writes prompt with special characters to temp file unescaped', async () => {
    mockCliSuccess('response');
    const specialPrompt = 'Fix $element with `backticks` and "quotes"';

    await ask({ prompt: specialPrompt });

    // Prompt is written raw — no PowerShell escaping since it goes through a file
    const [, content] = fs.writeFileSync.mock.calls[0];
    expect(content).toBe(specialPrompt);
  });

  test('escapes dollar signs in system prompt for PowerShell', async () => {
    mockCliSuccess('response');

    await ask({ prompt: 'test', system: 'Use $variable correctly' });
    const [, args] = mockExecFileAsync.mock.calls[0];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toContain('`$variable');
  });

  test('cleans up temp file after successful CLI call', async () => {
    mockCliSuccess('response');

    await ask({ prompt: 'test' });

    expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
    const tmpPath = fs.writeFileSync.mock.calls[0][0];
    expect(fs.unlinkSync).toHaveBeenCalledWith(tmpPath);
  });

  test('cleans up temp file even when the CLI call fails', async () => {
    mockCliFailure();

    await expect(ask({ prompt: 'test' })).rejects.toThrow();
    expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
  });

  test('handles large batch prompts via temp file without command-line limit', async () => {
    const largePrompt = 'A'.repeat(50000); // 50KB — well over 32KB EncodedCommand limit
    mockCliSuccess('{"items": []}');

    await ask({ prompt: largePrompt });

    // Large prompt goes to file, not command
    expect(fs.writeFileSync.mock.calls[0][1]).toBe(largePrompt);
    const [, args] = mockExecFileAsync.mock.calls[0];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).not.toContain(largePrompt);
    expect(decoded.length).toBeLessThan(1000); // command itself stays small
  });

  test('trims whitespace from CLI response', async () => {
    mockCliSuccess('  spaced response  \n');

    const result = await ask({ prompt: 'test' });
    expect(result.response).toBe('spaced response');
  });

  test('includes --json-schema when jsonSchema provided', async () => {
    mockCliSuccess(JSON.stringify({ fixedHtml: '<img alt="test">' }));

    const schema = { type: 'object', properties: { fixedHtml: { type: 'string' } }, required: ['fixedHtml'] };
    await ask({ prompt: 'test', jsonSchema: schema });

    const [, args] = mockExecFileAsync.mock.calls[0];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toContain('--json-schema');
  });

  test('returns raw JSON when --json-schema is used (no envelope extraction)', async () => {
    const rawJson = JSON.stringify({ fixedHtml: '<img alt="fix">', explanation: 'Fixed', wcagCriterion: '1.1.1', isApplicable: true });
    mockCliSuccess(rawJson);

    const result = await ask({
      prompt: 'test',
      jsonSchema: { type: 'object', properties: { fixedHtml: { type: 'string' } } }
    });

    expect(result.source).toBe('cli');
    expect(result.response).toBe(rawJson);
  });

  test('does not add --json-schema when jsonSchema is not provided', async () => {
    mockCliSuccess('plain response');

    await ask({ prompt: 'test' });

    const [, args] = mockExecFileAsync.mock.calls[0];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).not.toContain('--json-schema');
  });
});

describe('ask() — CLI failures throw (no API fallback)', () => {
  test('throws "CLI invocation timed out" when the CLI times out', async () => {
    mockCliTimeout();
    await expect(ask({ prompt: 'test' })).rejects.toThrow(/CLI invocation timed out/);
  });

  test('throws "claude CLI not found" when the executable is missing (ENOENT)', async () => {
    const err = new Error('spawn powershell.exe ENOENT');
    err.code = 'ENOENT';
    mockCliFailure({ error: err });
    await expect(ask({ prompt: 'test' })).rejects.toThrow(/claude CLI not found/);
  });

  test('throws "CLI invocation failed" when the CLI exits with an error', async () => {
    mockCliFailure({ stderr: 'some internal error with /paths' });
    await expect(ask({ prompt: 'test' })).rejects.toThrow(/CLI invocation failed/);
  });

  test('throws "CLI returned empty response" when the CLI emits nothing', async () => {
    mockCliSuccess('   \n');
    await expect(ask({ prompt: 'test' })).rejects.toThrow(/CLI returned empty response/);
  });

  test('does not leak raw error detail (no stderr/paths) in the thrown message', async () => {
    mockCliFailure({ error: Object.assign(new Error('ECONNREFUSED C:\\Users\\secret\\path'), {}) });
    await expect(ask({ prompt: 'test' })).rejects.toThrow(/^CLI invocation failed$/);
  });
});
