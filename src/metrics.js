// metrics.js — aggregates request metrics from the JSON-lines gateway logs.
// Reads today's and yesterday's log files (rotation is by calendar day, so a
// sliding 24h window can straddle the boundary) and filters to the window.

const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Health checks are status pings, not gateway traffic — excluded from metrics.
const EXCLUDED_PATHS = new Set(['/health', '/health/cli']);

function dateStr(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function readLogLines(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines — logging must never break metrics
    }
  }
  return entries;
}

function getMetrics({ now = Date.now(), windowMs = DEFAULT_WINDOW_MS } = {}) {
  const cutoff = now - windowMs;

  const filePaths = new Set([
    path.join(LOG_DIR, `gateway-${dateStr(now)}.log`),
    path.join(LOG_DIR, `gateway-${dateStr(now - windowMs)}.log`),
  ]);

  const entries = [...filePaths]
    .flatMap(readLogLines)
    .filter((e) => {
      const ts = Date.parse(e.ts);
      return Number.isFinite(ts) && ts >= cutoff && ts <= now;
    });

  const requests = entries.filter((e) => !EXCLUDED_PATHS.has(e.path));

  const total = requests.length;
  const failures = requests.filter((e) => e.status >= 400).length;
  const success = total - failures;

  const byPath = {};
  const bySource = { cli: 0, api: 0 };
  const durations = [];
  let lastRequestAt = null;

  for (const e of requests) {
    const key = e.path || 'unknown';
    if (!byPath[key]) byPath[key] = { total: 0, failures: 0 };
    byPath[key].total += 1;
    if (e.status >= 400) byPath[key].failures += 1;

    if (e.source === 'cli' || e.source === 'api') bySource[e.source] += 1;

    if (typeof e.durationMs === 'number') durations.push(e.durationMs);

    if (!lastRequestAt || e.ts > lastRequestAt) lastRequestAt = e.ts;
  }

  const avgDurationMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;

  return {
    generatedAt: new Date(now).toISOString(),
    windowHours: windowMs / (60 * 60 * 1000),
    requests: {
      total,
      success,
      failures,
      successRatePct: total ? Math.round((success / total) * 1000) / 10 : null,
    },
    byPath,
    bySource,
    avgDurationMs,
    lastRequestAt,
  };
}

module.exports = { getMetrics };
