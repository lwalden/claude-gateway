// auth-refresh.js — Proactive OAuth token refresh for Claude CLI credentials
//
// Claude CLI stores tokens in ~/.claude/.credentials.json.
// Access tokens last 8 hours (expires_in: 28800). Refresh tokens rotate.
// This module refreshes silently so the gateway never goes stale.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { checkAndNotify } = require('./auth-notify');

const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLIENT_ID = process.env.CLAUDE_OAUTH_CLIENT_ID || '';

// Refresh if token expires within this many ms (7.5 hours — half a period early)
const REFRESH_THRESHOLD_MS = 7.5 * 60 * 60 * 1000;
// Re-check interval (7.5 hours)
const REFRESH_INTERVAL_MS = 7.5 * 60 * 60 * 1000;

function readCredentials() {
  const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
  return JSON.parse(raw);
}

function writeCredentials(creds) {
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), 'utf8');
}

async function refreshTokens() {
  let creds;
  try {
    creds = readCredentials();
  } catch {
    console.warn('[auth-refresh] Could not read credentials file — skipping refresh');
    return;
  }

  if (!CLIENT_ID) {
    console.warn('[auth-refresh] CLAUDE_OAUTH_CLIENT_ID not set — skipping refresh');
    return;
  }

  const oauth = creds?.claudeAiOauth;
  if (!oauth?.refreshToken) {
    console.warn('[auth-refresh] No refresh token found — skipping');
    return;
  }

  const hoursRemaining = (oauth.expiresAt - Date.now()) / 1000 / 3600;
  const isExpired = hoursRemaining <= 0;
  await checkAndNotify(isExpired);

  if (hoursRemaining > REFRESH_THRESHOLD_MS / 1000 / 3600) {
    console.log(`[auth-refresh] Token valid for ${hoursRemaining.toFixed(1)}h — no refresh needed`);
    return;
  }

  console.log(`[auth-refresh] Token expires in ${hoursRemaining.toFixed(1)}h — refreshing...`);

  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: oauth.refreshToken,
        client_id: CLIENT_ID
      }).toString()
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[auth-refresh] Refresh failed (${res.status}):`, body.substring(0, 200));
      return;
    }

    const data = await res.json();
    if (!data.access_token) {
      console.error('[auth-refresh] Refresh response missing access_token');
      return;
    }

    creds.claudeAiOauth = {
      ...oauth,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? oauth.refreshToken,
      expiresAt: Date.now() + (data.expires_in ?? 28800) * 1000
    };

    writeCredentials(creds);
    const newExpiry = new Date(creds.claudeAiOauth.expiresAt).toLocaleTimeString();
    console.log(`[auth-refresh] Token refreshed — new expiry: ${newExpiry}`);
    await checkAndNotify(false);
  } catch (err) {
    console.error('[auth-refresh] Refresh error:', err.message);
  }
}

function startAutoRefresh() {
  // Refresh immediately on startup if needed, then on a recurring interval
  refreshTokens();
  setInterval(refreshTokens, REFRESH_INTERVAL_MS);
}

module.exports = { startAutoRefresh, refreshTokens };
