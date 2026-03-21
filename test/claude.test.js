const { execFile } = require('child_process');
const { promisify } = require('util');

// Mock child_process before requiring claude.js
jest.mock('child_process', () => ({
  execFile: jest.fn()
}));

// Mock global fetch for API fallback tests
global.fetch = jest.fn();

// Set env defaults for tests
process.env.ANTHROPIC_API_KEY = 'test-api-key';
process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

const { ask } = require('../src/claude');

// Helper: make execFile callback-style mock resolve
function mockCliSuccess(stdout) {
  execFile.mockImplementation((cmd, args, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    cb(null, { stdout });
  });
}

function mockCliFailure(err) {
  execFile.mockImplementation((cmd, args, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    cb(err);
  });
}

// promisify wraps execFile, so we need the mock to work with callbacks
// Jest's mock of execFile is already callback-based; promisify will wrap it

beforeEach(() => {
  jest.clearAllMocks();
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
    expect(execFile).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('passes system prompt to CLI when provided', async () => {
    mockCliSuccess('response');

    await ask({ prompt: 'test', system: 'be helpful' });
    const call = execFile.mock.calls[0];
    // The encoded command (args[3]) should contain the system prompt flag
    const encoded = call[1][3]; // -EncodedCommand value
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toContain('--append-system-prompt');
    expect(decoded).toContain('be helpful');
  });
});

describe('ask() — CLI failure triggers API fallback', () => {
  function mockApiSuccess(text = 'Hello from API') {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text }] })
    });
  }

  test('falls back to API when CLI times out', async () => {
    const err = new Error('timeout');
    err.killed = true;
    mockCliFailure(err);
    mockApiSuccess();

    const result = await ask({ prompt: 'test' });
    expect(result.source).toBe('api');
    expect(result.response).toBe('Hello from API');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('falls back to API when CLI is not found (ENOENT)', async () => {
    const err = new Error('spawn powershell.exe ENOENT');
    err.code = 'ENOENT';
    mockCliFailure(err);
    mockApiSuccess();

    const result = await ask({ prompt: 'test' });
    expect(result.source).toBe('api');
  });

  test('falls back to API when CLI returns empty output', async () => {
    mockCliSuccess('   \n');
    mockApiSuccess();

    const result = await ask({ prompt: 'test' });
    expect(result.source).toBe('api');
  });

  test('uses caller-specified model for API fallback', async () => {
    mockCliFailure(new Error('cli down'));
    mockApiSuccess();

    await ask({ prompt: 'test', model: 'claude-haiku-4-5-20251001' });
    const fetchBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetchBody.model).toBe('claude-haiku-4-5-20251001');
  });

  test('uses default model when none specified', async () => {
    mockCliFailure(new Error('cli down'));
    mockApiSuccess();

    const result = await ask({ prompt: 'test' });
    expect(result.model).toBe('claude-sonnet-4-20250514');
  });

  test('sends system prompt to API when provided', async () => {
    mockCliFailure(new Error('cli down'));
    mockApiSuccess();

    await ask({ prompt: 'test', system: 'be concise' });
    const fetchBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetchBody.system).toBe('be concise');
  });
});

describe('ask() — API path failures', () => {
  test('throws when both CLI and API fail', async () => {
    mockCliFailure(new Error('cli down'));
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    });

    await expect(ask({ prompt: 'test' })).rejects.toThrow(/Anthropic API error 500/);
  });

  test('throws when CLI fails and no ANTHROPIC_API_KEY', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = '';

    // Need to re-require to pick up env change — but module is cached.
    // Instead, test indirectly: the module reads env at load time.
    // We'll test this by creating a fresh module instance.
    jest.resetModules();
    jest.mock('child_process', () => ({
      execFile: jest.fn((cmd, args, opts, cb) => {
        if (typeof opts === 'function') { cb = opts; opts = {}; }
        cb(new Error('cli down'));
      })
    }));
    delete process.env.ANTHROPIC_API_KEY;

    const { ask: freshAsk } = require('../src/claude');
    await expect(freshAsk({ prompt: 'test' })).rejects.toThrow(/ANTHROPIC_API_KEY is not set/);

    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  test('throws when API returns empty content', async () => {
    mockCliFailure(new Error('cli down'));
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] })
    });

    await expect(ask({ prompt: 'test' })).rejects.toThrow(/empty response/);
  });
});
