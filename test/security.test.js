const request = require('supertest');
const { createApp } = require('../src/app');

const mockAsk = jest.fn();
jest.mock('../src/claude', () => ({
  ask: (...args) => mockAsk(...args)
}));

const API_KEY = 'test-security-key';
let app;

beforeAll(() => {
  app = createApp({ gatewayApiKey: API_KEY });
});

beforeEach(() => {
  mockAsk.mockReset();
});

const authed = (req) => req.set('Authorization', `Bearer ${API_KEY}`);

describe('Prompt length validation', () => {
  test('rejects prompts exceeding 100K characters', async () => {
    const res = await authed(request(app).post('/ask'))
      .send({ prompt: 'a'.repeat(100_001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maximum length/);
  });

  test('accepts prompts at the 100K limit', async () => {
    mockAsk.mockResolvedValue({ response: 'ok', source: 'cli', model: 'subscription' });
    const res = await authed(request(app).post('/ask'))
      .send({ prompt: 'a'.repeat(100_000) });
    expect(res.status).toBe(200);
  });
});

describe('System and model type validation', () => {
  test('rejects non-string system parameter', async () => {
    const res = await authed(request(app).post('/ask'))
      .send({ prompt: 'hello', system: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/system must be a string/);
  });

  test('rejects non-string model parameter', async () => {
    const res = await authed(request(app).post('/ask'))
      .send({ prompt: 'hello', model: ['array'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/model must be a string/);
  });

  test('rejects system exceeding 100K characters', async () => {
    const res = await authed(request(app).post('/ask'))
      .send({ prompt: 'hello', system: 'a'.repeat(100_001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/system exceeds maximum length/);
  });

  test('rejects model exceeding 256 characters', async () => {
    const res = await authed(request(app).post('/ask'))
      .send({ prompt: 'hello', model: 'a'.repeat(257) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/model exceeds maximum length/);
  });

  test('accepts undefined system and model (optional)', async () => {
    mockAsk.mockResolvedValue({ response: 'ok', source: 'cli', model: 'subscription' });
    const res = await authed(request(app).post('/ask'))
      .send({ prompt: 'hello' });
    expect(res.status).toBe(200);
  });
});

describe('Error message sanitization', () => {
  test('passes through known safe CLI messages', async () => {
    mockAsk.mockRejectedValue(new Error('CLI invocation timed out'));
    const res = await authed(request(app).post('/ask'))
      .send({ prompt: 'test' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('CLI invocation timed out');
  });

  test('returns generic message for unexpected errors (no internal detail leaks)', async () => {
    mockAsk.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:443 — stack trace with internal paths'));
    const res = await authed(request(app).post('/ask'))
      .send({ prompt: 'test' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('An internal error occurred while processing your request');
    expect(res.body.error).not.toContain('ECONNREFUSED');
  });
});

describe('Timing-safe auth', () => {
  test('rejects tokens of different length', async () => {
    const res = await request(app)
      .post('/ask')
      .set('Authorization', 'Bearer short')
      .send({ prompt: 'hello' });
    expect(res.status).toBe(401);
  });

  test('rejects empty token', async () => {
    const res = await request(app)
      .post('/ask')
      .set('Authorization', 'Bearer ')
      .send({ prompt: 'hello' });
    expect(res.status).toBe(401);
  });
});
