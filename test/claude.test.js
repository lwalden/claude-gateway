const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

// Mock global fetch for API fallback tests
global.fetch = jest.fn();

// Set env defaults for tests
process.env.ANTHROPIC_API_KEY = 'test-api-key';
process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

const { spawn } = require('child_process');
const { ask } = require('../src/claude');

function createMockChild({ stdout = '', stderr = '', code = 0, signal = null, error = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();

  // Write data then emit close after streams drain
  setImmediate(() => {
    if (error) {
      child.emit('error', error);
      return;
    }
    child.stdout.end(stdout);
    child.stderr.end(stderr);
    // Emit close after stdout ends so all data events fire first
    child.stdout.on('end', () => {
      setImmediate(() => child.emit('close', code, signal));
    });
  });

  return child;
}

function mockCliSuccess(stdout) {
  spawn.mockImplementation(() => createMockChild({ stdout }));
}

function mockCliFailure({ stderr = '', code = 1, signal = null, error = null } = {}) {
  spawn.mockImplementation(() => createMockChild({ stderr, code, signal, error }));
}

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
    expect(spawn).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('pipes prompt via stdin (not interpolated into command)', async () => {
    const stdinChunks = [];
    spawn.mockImplementation(() => {
      const child = createMockChild({ stdout: 'response' });
      const origWrite = child.stdin.write.bind(child.stdin);
      child.stdin.write = (chunk, enc, cb) => {
        stdinChunks.push(chunk.toString());
        return origWrite(chunk, enc, cb);
      };
      return child;
    });

    await ask({ prompt: 'test prompt with "quotes" and $(injection)' });
    expect(stdinChunks.join('')).toBe('test prompt with "quotes" and $(injection)');
  });

  test('passes system prompt as CLI argument when provided', async () => {
    mockCliSuccess('response');

    await ask({ prompt: 'test', system: 'be helpful' });
    const spawnArgs = spawn.mock.calls[0][1];
    expect(spawnArgs).toContain('--append-system-prompt');
    expect(spawnArgs).toContain('be helpful');
  });

  test('does not include system flag when system is not provided', async () => {
    mockCliSuccess('response');

    await ask({ prompt: 'test' });
    const spawnArgs = spawn.mock.calls[0][1];
    expect(spawnArgs).not.toContain('--append-system-prompt');
  });
});

describe('ask() — CLI failure triggers API fallback', () => {
  function mockApiSuccess(text = 'Hello from API') {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text }] })
    });
  }

  test('falls back to API when CLI times out (killed signal)', async () => {
    mockCliFailure({ signal: 'SIGTERM' });
    mockApiSuccess();

    const result = await ask({ prompt: 'test' });
    expect(result.source).toBe('api');
    expect(result.response).toBe('Hello from API');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('falls back to API when CLI spawn errors (ENOENT)', async () => {
    const err = new Error('spawn cmd.exe ENOENT');
    err.code = 'ENOENT';
    mockCliFailure({ error: err });
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

  test('falls back to API when CLI exits with non-zero code', async () => {
    mockCliFailure({ code: 1, stderr: 'some error' });
    mockApiSuccess();

    const result = await ask({ prompt: 'test' });
    expect(result.source).toBe('api');
  });

  test('uses caller-specified model for API fallback', async () => {
    mockCliFailure({ code: 1 });
    mockApiSuccess();

    await ask({ prompt: 'test', model: 'claude-haiku-4-5-20251001' });
    const fetchBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetchBody.model).toBe('claude-haiku-4-5-20251001');
  });

  test('uses default model when none specified', async () => {
    mockCliFailure({ code: 1 });
    mockApiSuccess();

    const result = await ask({ prompt: 'test' });
    expect(result.model).toBe('claude-sonnet-4-20250514');
  });

  test('sends system prompt to API when provided', async () => {
    mockCliFailure({ code: 1 });
    mockApiSuccess();

    await ask({ prompt: 'test', system: 'be concise' });
    const fetchBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetchBody.system).toBe('be concise');
  });
});

describe('ask() — API path failures', () => {
  test('throws when both CLI and API fail', async () => {
    mockCliFailure({ code: 1 });
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    });

    await expect(ask({ prompt: 'test' })).rejects.toThrow(/Anthropic API error 500/);
  });

  test('throws when CLI fails and no ANTHROPIC_API_KEY', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    jest.resetModules();

    jest.mock('child_process', () => {
      const { PassThrough, } = require('stream');
      const { EventEmitter } = require('events');
      return {
        spawn: jest.fn(() => {
          const child = new EventEmitter();
          child.stdout = new PassThrough();
          child.stderr = new PassThrough();
          child.stdin = new PassThrough();
          setImmediate(() => {
            child.stdout.end('');
            child.stderr.end('cli down');
            child.stdout.on('end', () => {
              setImmediate(() => child.emit('close', 1, null));
            });
          });
          return child;
        })
      };
    });

    const { ask: freshAsk } = require('../src/claude');
    await expect(freshAsk({ prompt: 'test' })).rejects.toThrow(/ANTHROPIC_API_KEY is not set/);

    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  test('throws when API returns empty content', async () => {
    mockCliFailure({ code: 1 });
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] })
    });

    await expect(ask({ prompt: 'test' })).rejects.toThrow(/empty response/);
  });
});
