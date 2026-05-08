// auth-notify.js — Token expiry incident tracking and webhook notification
//
// Sends one notification per incident (expired→ok→expired = 2 incidents).
// Ongoing incidents (expired→expired→...) get at most one resend per 24h
// as a safety cap in case the process restarts.

const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_PATH = path.join(os.homedir(), '.claude', 'auth-notify-state.json');
const WEBHOOK_URL = process.env.NOTIFY_WEBHOOK_URL || '';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { lastStatus: 'ok', incidentStart: null, lastNotifiedAt: null };
  }
}

function writeState(state) {
  const dir = path.dirname(STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

async function sendWebhook(subject, isNewIncident, incidentStart) {
  if (!WEBHOOK_URL) {
    console.warn('[auth-notify] NOTIFY_WEBHOOK_URL not set — skipping notification');
    return;
  }
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        isNewIncident,
        incidentStart: new Date(incidentStart).toISOString(),
        timestamp: new Date().toISOString()
      })
    });
    if (!res.ok) {
      console.error(`[auth-notify] Webhook returned ${res.status}`);
    } else {
      console.log(`[auth-notify] Notification sent: ${subject}`);
    }
  } catch (err) {
    console.error('[auth-notify] Failed to send notification:', err.message);
  }
}

async function checkAndNotify(isExpired) {
  const state = readState();
  const now = Date.now();

  if (!isExpired) {
    if (state.lastStatus === 'expired') {
      writeState({ lastStatus: 'ok', incidentStart: null, lastNotifiedAt: null });
      console.log('[auth-notify] Token restored — incident resolved');
    }
    return;
  }

  // Token is expired
  if (state.lastStatus === 'ok') {
    // Transition ok → expired: new incident
    const newState = { lastStatus: 'expired', incidentStart: now, lastNotifiedAt: now };
    writeState(newState);
    await sendWebhook('CRITICAL: Claude Gateway auth token expired', true, now);
  } else if (state.lastStatus === 'expired') {
    // Ongoing incident — resend only if 24h has elapsed (safety cap for restarts)
    const elapsed = now - (state.lastNotifiedAt || 0);
    if (elapsed >= ONE_DAY_MS) {
      writeState({ ...state, lastNotifiedAt: now });
      await sendWebhook('CRITICAL: Claude Gateway auth token still expired', false, state.incidentStart);
    }
  }
}

module.exports = { checkAndNotify, readState, writeState };
