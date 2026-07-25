const fs = require('fs');
const path = require('path');
const os = require('os');

let LOG_DIR;
let getMetrics;

function writeLog(dateStr, lines) {
  const file = path.join(LOG_DIR, `gateway-${dateStr}.log`);
  const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  fs.writeFileSync(file, body, 'utf8');
}

beforeEach(() => {
  LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-metrics-test-'));
  process.env.LOG_DIR = LOG_DIR;
  jest.resetModules();
  ({ getMetrics } = require('../src/metrics'));
});

afterEach(() => {
  delete process.env.LOG_DIR;
  fs.rmSync(LOG_DIR, { recursive: true, force: true });
});

describe('getMetrics', () => {
  test('returns zeroed metrics when no log files exist', () => {
    const now = Date.parse('2026-07-25T12:00:00.000Z');
    const metrics = getMetrics({ now });
    expect(metrics.requests).toEqual({ total: 0, success: 0, failures: 0, successRatePct: null });
    expect(metrics.avgDurationMs).toBeNull();
    expect(metrics.lastRequestAt).toBeNull();
  });

  test('counts requests and failures within the 24h window', () => {
    const now = Date.parse('2026-07-25T12:00:00.000Z');
    writeLog('2026-07-25', [
      { ts: '2026-07-25T11:00:00.000Z', method: 'POST', path: '/ask', status: 200, durationMs: 1000, source: 'cli' },
      { ts: '2026-07-25T11:30:00.000Z', method: 'POST', path: '/ask', status: 502, durationMs: 500, error: 'boom' },
    ]);
    const metrics = getMetrics({ now });
    expect(metrics.requests).toEqual({ total: 2, success: 1, failures: 1, successRatePct: 50 });
    expect(metrics.avgDurationMs).toBe(750);
    expect(metrics.lastRequestAt).toBe('2026-07-25T11:30:00.000Z');
  });

  test('excludes entries older than the window', () => {
    const now = Date.parse('2026-07-25T12:00:00.000Z');
    writeLog('2026-07-24', [
      { ts: '2026-07-24T10:00:00.000Z', method: 'POST', path: '/ask', status: 200, durationMs: 100 },
    ]);
    const metrics = getMetrics({ now });
    expect(metrics.requests.total).toBe(0);
  });

  test('includes entries from yesterday that fall within the last 24h', () => {
    const now = Date.parse('2026-07-25T02:00:00.000Z');
    writeLog('2026-07-24', [
      { ts: '2026-07-24T10:00:00.000Z', method: 'POST', path: '/ask', status: 200, durationMs: 100 },
    ]);
    const metrics = getMetrics({ now });
    expect(metrics.requests.total).toBe(1);
  });

  test('excludes /health and /health/cli from request counts', () => {
    const now = Date.parse('2026-07-25T12:00:00.000Z');
    writeLog('2026-07-25', [
      { ts: '2026-07-25T11:00:00.000Z', method: 'GET', path: '/health', status: 200, durationMs: 1 },
      { ts: '2026-07-25T11:00:00.000Z', method: 'GET', path: '/health/cli', status: 200, durationMs: 2 },
      { ts: '2026-07-25T11:00:00.000Z', method: 'POST', path: '/ask', status: 200, durationMs: 10 },
    ]);
    const metrics = getMetrics({ now });
    expect(metrics.requests.total).toBe(1);
  });

  test('breaks down by path and source', () => {
    const now = Date.parse('2026-07-25T12:00:00.000Z');
    writeLog('2026-07-25', [
      { ts: '2026-07-25T11:00:00.000Z', method: 'POST', path: '/ask', status: 200, durationMs: 10, source: 'cli' },
      { ts: '2026-07-25T11:05:00.000Z', method: 'POST', path: '/ask', status: 500, durationMs: 20, source: 'cli' },
      { ts: '2026-07-25T11:06:00.000Z', method: 'GET', path: '/nonexistent', status: 404, durationMs: 1 },
    ]);
    const metrics = getMetrics({ now });
    expect(metrics.byPath['/ask']).toEqual({ total: 2, failures: 1 });
    expect(metrics.byPath['/nonexistent']).toEqual({ total: 1, failures: 1 });
    expect(metrics.bySource).toEqual({ cli: 2, api: 0 });
  });

  test('ignores malformed log lines', () => {
    const now = Date.parse('2026-07-25T12:00:00.000Z');
    const file = path.join(LOG_DIR, 'gateway-2026-07-25.log');
    fs.writeFileSync(file, 'not json\n{"ts":"2026-07-25T11:00:00.000Z","path":"/ask","status":200,"durationMs":5}\n', 'utf8');
    const metrics = getMetrics({ now });
    expect(metrics.requests.total).toBe(1);
  });
});
