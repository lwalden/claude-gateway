// Mock global fetch for API fallback tests
global.fetch = jest.fn();

// execFile mock — must support util.promisify via [custom] symbol
const { promisify } = require('util');
const mockExecFile = jest.fn();
mockExecFile[promisify.custom] = jest.fn();
jest.mock('child_process', () => ({
  execFile: mockExecFile
}));

// Set env defaults for tests
process.env.ANTHROPIC_API_KEY = 'test-api-key';
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

function mockApiSuccess(text = 'Hello from API') {
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ text }] })
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Restore the custom symbol after clearAllMocks
  mockExecFile[promisify.custom] = mockExecFileAsync;
});

describe('ask() — CLI path', () => {
  test('returns CLI response with source "cli" on success', async () => {
    mockCliSuccess('Hello from CLI\n');

    const result = await ask({ prompt: 'test prompt' });
    expect(result).toEqual({
      response: 'Hello from CLI',
      source: 'cli',
      model: 'subscription'
    });
    expect(mockExecFileAsync).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('calls powershell.exe with -EncodedCommand', async () => {
    mockCliSuccess('response');

    await ask({ prompt: 'test' });
    const [cmd, args] = mockExecFileAsync.mock.calls[0];
    expect(cmd).toBe('powershell.exe');
    expect(args).toContain('-EncodedCommand');
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

  test('escapes dollar signs in prompt to prevent PowerShell variable expansion', async () => {
    mockCliSuccess('response');

    await ask({ prompt: 'Fix the $element with aria-role' });
    const [, args] = mockExecFileAsync.mock.calls[0];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    // Dollar signs must be escaped as `$ in PowerShell double-quoted strings
    expect(decoded).toContain('`$element');
    expect(decoded).not.toMatch(/[^`]\$element/); // raw $element must not appear
  });

  test('escapes backticks in prompt to prevent PowerShell escape interpretation', async () => {
    mockCliSuccess('response');

    await ask({ prompt: 'Use `code` formatting' });
    const [, args] = mockExecFileAsync.mock.calls[0];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    // Backticks must be doubled in PowerShell double-quoted strings
    expect(decoded).toContain('``code``');
  });

  test('trims whitespace from CLI response', async () => {
    mockCliSuccess('  spaced response  \n');

    const result = await ask({ prompt: 'test' });
    expect(result.response).toBe('spaced response');
  });

  test('falls back to API when CLI returns empty output', async () => {
    mockCliSuccess('   \n');
    mockApiSuccess();

    const result = await ask({ prompt: 'test' });
    expect(result.source).toBe('api');
  });

  test('includes --output-format json and --json-schema when jsonSchema provided', async () => {
    mockCliSuccess(JSON.stringify({
      type: 'result',
      structured_output: { fixedHtml: '<img alt="test">', explanation: 'Added alt', wcagCriterion: '1.1.1', isApplicable: true }
    }));

    const schema = { type: 'object', properties: { fixedHtml: { type: 'string' } }, required: ['fixedHtml'] };
    await ask({ prompt: 'test', jsonSchema: schema });

    const [, args] = mockExecFileAsync.mock.calls[0];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toContain('--output-format json');
    expect(decoded).toContain('--json-schema');
  });

  test('extracts structured_output from CLI JSON envelope', async () => {
    const structured = { fixedHtml: '<img alt="fix">', explanation: 'Fixed', wcagCriterion: '1.1.1', isApplicable: true };
    mockCliSuccess(JSON.stringify({
      type: 'result',
      subtype: 'success',
      structured_output: structured
    }));

    const result = await ask({
      prompt: 'test',
      jsonSchema: { type: 'object', properties: { fixedHtml: { type: 'string' } } }
    });

    expect(result.source).toBe('cli');
    expect(JSON.parse(result.response)).toEqual(structured);
  });

  test('does not add --json-schema when jsonSchema is not provided', async () => {
    mockCliSuccess('plain response');

    await ask({ prompt: 'test' });

    const [, args] = mockExecFileAsync.mock.calls[0];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).not.toContain('--json-schema');
    expect(decoded).not.toContain('--output-format');
  });
});

describe('ask() — CLI failure triggers API fallback', () => {
  test('falls back to API when CLI times out (killed)', async () => {
    mockCliTimeout();
    mockApiSuccess();

    const result = await ask({ prompt: 'test' });
    expect(result.source).toBe('api');
    expect(result.response).toBe('Hello from API');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('falls back to API when CLI exec errors (ENOENT)', async () => {
    const err = new Error('spawn powershell.exe ENOENT');
    err.code = 'ENOENT';
    mockCliFailure({ error: err });
    mockApiSuccess();

    const result = await ask({ prompt: 'test' });
    expect(result.source).toBe('api');
  });

  test('falls back to API when CLI exits with error', async () => {
    mockCliFailure({ stderr: 'some error' });
    mockApiSuccess();

    const result = await ask({ prompt: 'test' });
    expect(result.source).toBe('api');
  });

  test('uses caller-specified model for API fallback', async () => {
    mockCliFailure();
    mockApiSuccess();

    await ask({ prompt: 'test', model: 'claude-haiku-4-5-20251001' });
    const fetchBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetchBody.model).toBe('claude-haiku-4-5-20251001');
  });

  test('uses default model when none specified', async () => {
    mockCliFailure();
    mockApiSuccess();

    const result = await ask({ prompt: 'test' });
    expect(result.model).toBe('claude-sonnet-4-20250514');
  });

  test('sends system prompt to API when provided', async () => {
    mockCliFailure();
    mockApiSuccess();

    await ask({ prompt: 'test', system: 'be concise' });
    const fetchBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetchBody.system).toBe('be concise');
  });
});

describe('ask() — API path failures', () => {
  test('throws when both CLI and API fail', async () => {
    mockCliFailure();
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    });

    await expect(ask({ prompt: 'test' })).rejects.toThrow(/Upstream API request failed/);
  });

  test('throws when CLI fails and no ANTHROPIC_API_KEY', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    jest.resetModules();

    const mockFreshAsync = jest.fn().mockRejectedValue(new Error('CLI failed'));
    const mockFreshExecFile = Object.assign(jest.fn(), { [promisify.custom]: mockFreshAsync });
    jest.mock('child_process', () => ({
      execFile: mockFreshExecFile
    }));

    const { ask: freshAsk } = require('../src/claude');
    await expect(freshAsk({ prompt: 'test' })).rejects.toThrow(/ANTHROPIC_API_KEY is not set/);

    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  test('throws when API returns empty content', async () => {
    mockCliFailure();
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] })
    });

    await expect(ask({ prompt: 'test' })).rejects.toThrow(/empty response/);
  });
});
