# claude-gateway

HTTP gateway to Claude. Runs the local Claude CLI on your Claude **subscription** (OAuth) — a single `POST /ask` endpoint any tool, script, or service can call over HTTP. Subscription-only: there is no Anthropic API key and no API fallback.

> **Calling a gateway from your app?** → **[Integration guide](docs/INTEGRATION.md)**. The rest of this README is about running your own instance.

## Requirements

- Node.js 18+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and signed in to your subscription (`claude -p "hello"` should return a reply)
- Windows (CLI invocation uses PowerShell; cross-platform is on the roadmap)

## Setup

```bash
git clone https://github.com/lwalden/claude-gateway.git
cd claude-gateway
npm install
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GATEWAY_API_KEY` | Yes | - | Bearer token callers must send |
| `ANTHROPIC_MODEL` | No | `claude-opus-4-6` | Model passed to `claude --model` |
| `CLI_TIMEOUT_MS` | No | `30000` | Timeout (ms) for the Claude CLI invocation |
| `PORT` | No | `3131` | Port the gateway listens on |
| `CLAUDE_OAUTH_CLIENT_ID` | No | - | Claude Code OAuth client ID; enables automatic token refresh |
| `LOG_DIR` | No | `./logs` | Directory for per-request log files |
| `NOTIFY_WEBHOOK_URL` | No | - | Webhook POSTed when the CLI auth token expires (optional) |

## Usage

```bash
# Start the server
npm start

# Start with file watching (auto-restart on changes)
npm run dev
```

The full HTTP contract is published as an OpenAPI 3.1 spec in [`openapi.yaml`](openapi.yaml) — import it into Postman/Insomnia or use it to generate a client.

## Autostart on boot (Windows)

To have the gateway start automatically at login, register a Scheduled Task that
runs `scripts/start-gateway-hidden.vbs` (a headless wrapper — no console window,
no focus steal) at logon:

```powershell
$action = New-ScheduledTaskAction -Execute 'wscript.exe' `
  -Argument '//nologo "C:\repos\claude-gateway\scripts\start-gateway-hidden.vbs"'
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'ClaudeGatewayStartup' -Action $action `
  -Trigger $trigger -Settings $settings -RunLevel Limited
```

`ExecutionTimeLimit` is set to zero (unlimited) since this is a persistent server,
not a short-lived task. `scripts/start-gateway.ps1` (invoked by the VBS) also opens
the status dashboard (`http://localhost:<PORT>/`) in your default browser once the
gateway responds healthy — only the `node` process itself runs hidden; the
dashboard tab is meant to be visible. It skips
launching if the configured `PORT` is already listening, so a stray re-trigger
doesn't spawn a second instance. Requires a `.env` with `GATEWAY_API_KEY` set (see
Setup above) and the Claude CLI signed in under the logged-in user's account.

### `POST /ask`

```bash
curl -X POST http://localhost:3131/ask \
  -H "Authorization: Bearer YOUR_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Explain closures in JavaScript"}'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | The prompt to send to Claude |
| `system` | string | No | System prompt |
| `model` | string | No | Model override; passed to `claude --model` |
| `jsonSchema` | object | No | JSON Schema to enforce structured output |

**Response:**

```json
{
  "response": "A closure is a function that...",
  "source": "cli",
  "model": "subscription",
  "durationMs": 2340
}
```

`source` is always `"cli"` and `model` is always `"subscription"` (both retained for backward compatibility). If `jsonSchema` was supplied, `response` is a JSON *string* the caller must parse.

### `GET /health`

Returns `{"status": "ok", "service": "claude-gateway"}`. No auth required.

### `GET /health/cli`

Returns the CLI auth token status (`ok`, `expired`, or `unknown`). Unauthenticated callers get the status only; send `Authorization: Bearer <GATEWAY_API_KEY>` to also get expiry timing (`expiresAt`, `hoursRemaining`) or the `unknown` reason. A wrong token gets `401`.

## Testing

```bash
npm test
```

## How it works

1. Prompt is written to a temp file
2. PowerShell pipes the file to `claude -p` via `Get-Content | claude`
3. If the CLI succeeds, the response is returned
4. If the CLI fails or times out, the request fails with `502` — there is no API fallback
5. Temp file is cleaned up regardless of outcome

The temp file approach avoids PowerShell's 32KB command-line limit, which large prompts (e.g. batch remediation requests) can exceed.
