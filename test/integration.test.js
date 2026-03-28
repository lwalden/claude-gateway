const request = require('supertest');
const { createApp } = require('../src/app');

const mockAsk = jest.fn();
jest.mock('../src/claude', () => ({
  ask: (...args) => mockAsk(...args)
}));

const API_KEY = 'integration-test-key';
let app;

beforeAll(() => {
  app = createApp({ gatewayApiKey: API_KEY });
});

beforeEach(() => {
  mockAsk.mockReset();
});

const authed = (req) => req.set('Authorization', `Bearer ${API_KEY}`);

describe('GET /health', () => {
  test('returns 200 with status ok (no auth required)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'claude-gateway' });
  });
});

describe('POST /ask — full flow', () => {
  test('returns Claude response with source and durationMs', async () => {
    mockAsk.mockResolvedValue({ response: 'Hello!', source: 'cli', model: 'subscription' });

    const res = await authed(request(app).post('/ask'))
      .send({ prompt: 'Hi there' });

    expect(res.status).toBe(200);
    expect(res.body.response).toBe('Hello!');
    expect(res.body.source).toBe('cli');
    expect(res.body.model).toBe('subscription');
    expect(typeof res.body.durationMs).toBe('number');
  });

  test('passes prompt, system, and model to ask()', async () => {
    mockAsk.mockResolvedValue({ response: 'ok', source: 'api', model: 'claude-haiku-4-5-20251001' });

    await authed(request(app).post('/ask'))
      .send({ prompt: 'test', system: 'be brief', model: 'claude-haiku-4-5-20251001' });

    expect(mockAsk).toHaveBeenCalledWith({
      prompt: 'test',
      system: 'be brief',
      model: 'claude-haiku-4-5-20251001'
    });
  });

  test('trims whitespace from prompt before passing to ask()', async () => {
    mockAsk.mockResolvedValue({ response: 'ok', source: 'cli', model: 'subscription' });

    await authed(request(app).post('/ask'))
      .send({ prompt: '  hello  ' });

    expect(mockAsk).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'hello' })
    );
  });
});

describe('POST /ask — error propagation', () => {
  test('returns 502 when ask() throws', async () => {
    mockAsk.mockRejectedValue(new Error('CLI and API both failed'));

    const res = await authed(request(app).post('/ask'))
      .send({ prompt: 'test' });

    expect(res.status).toBe(502);
    // Error is sanitized — unknown messages get a generic response
    expect(res.body.error).toBe('An internal error occurred while processing your request');
    expect(typeof res.body.durationMs).toBe('number');
  });
});

describe('Unknown routes', () => {
  test('returns JSON 404 for unregistered paths', async () => {
    const res = await request(app).get('/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not Found');
  });
});
