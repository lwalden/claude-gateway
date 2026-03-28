const request = require('supertest');
const { createApp } = require('../src/app');

// Mock claude.js so /ask doesn't invoke real CLI/API
jest.mock('../src/claude', () => ({
  ask: jest.fn().mockResolvedValue({ response: 'mocked', source: 'cli', model: 'subscription' })
}));

describe('Auth middleware', () => {
  test('returns 500 when GATEWAY_API_KEY is not configured', async () => {
    const app = createApp({ gatewayApiKey: '' });
    const res = await request(app)
      .post('/ask')
      .send({ prompt: 'hello' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/GATEWAY_API_KEY/);
  });

  test('returns 401 when no Authorization header is provided', async () => {
    const app = createApp({ gatewayApiKey: 'test-key' });
    const res = await request(app)
      .post('/ask')
      .send({ prompt: 'hello' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  test('returns 401 when token is wrong', async () => {
    const app = createApp({ gatewayApiKey: 'test-key' });
    const res = await request(app)
      .post('/ask')
      .set('Authorization', 'Bearer wrong-key')
      .send({ prompt: 'hello' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  test('returns 401 when Authorization header is not Bearer format', async () => {
    const app = createApp({ gatewayApiKey: 'test-key' });
    const res = await request(app)
      .post('/ask')
      .set('Authorization', 'Basic dXNlcjpwYXNz')
      .send({ prompt: 'hello' });
    expect(res.status).toBe(401);
  });

  test('passes through with valid Bearer token', async () => {
    const app = createApp({ gatewayApiKey: 'test-key' });
    const res = await request(app)
      .post('/ask')
      .set('Authorization', 'Bearer test-key')
      .send({ prompt: 'hello' });
    expect(res.status).toBe(200);
    expect(res.body.response).toBe('mocked');
  });
});

describe('Input validation', () => {
  let app;
  beforeAll(() => {
    app = createApp({ gatewayApiKey: 'test-key' });
  });

  const authed = (req) => req.set('Authorization', 'Bearer test-key');

  test('returns 400 when prompt is missing', async () => {
    const res = await authed(request(app).post('/ask')).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/prompt/);
  });

  test('returns 400 when prompt is empty string', async () => {
    const res = await authed(request(app).post('/ask')).send({ prompt: '' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when prompt is whitespace only', async () => {
    const res = await authed(request(app).post('/ask')).send({ prompt: '   ' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when prompt is not a string', async () => {
    const res = await authed(request(app).post('/ask')).send({ prompt: 42 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when body is null', async () => {
    const res = await authed(
      request(app).post('/ask').set('Content-Type', 'application/json')
    ).send('null');
    expect(res.status).toBe(400);
  });
});
