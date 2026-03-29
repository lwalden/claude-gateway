// logger.js — JSON-lines file logger with daily rotation

const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogPath() {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(LOG_DIR, `gateway-${date}.log`);
}

/**
 * Append a JSON-lines entry to the daily log file.
 * Non-blocking — write errors are swallowed so logging never breaks requests.
 */
function log(entry) {
  try {
    ensureLogDir();
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(getLogPath(), line, 'utf8');
  } catch {
    // Logging must never crash the server
  }
}

/**
 * Express middleware — logs every request/response.
 */
function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const entry = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: duration,
    };

    // Capture source (cli/api) from response body if available
    if (res._logMeta) {
      Object.assign(entry, res._logMeta);
    }

    // Don't log health checks at info level — they're noise
    if (req.path === '/health') {
      entry.level = 'debug';
    } else if (res.statusCode >= 500) {
      entry.level = 'error';
    } else if (res.statusCode >= 400) {
      entry.level = 'warn';
    } else {
      entry.level = 'info';
    }

    log(entry);
  });

  next();
}

module.exports = { log, requestLogger };
