# claude-gateway

HTTP gateway to Claude. Tries the local Claude CLI (subscription) first, falls back to the Anthropic API if the CLI is unavailable or times out.

Any tool, script, or service that can make an HTTP request can get Claude responses via a single `POST /ask` endpoint.

## Requirements

- Node.js 18+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude -p "hello"` should work)
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
| `ANTHROPIC_API_KEY` | No | - | API key for fallback when CLI is unavailable |
| `ANTHROPIC_MODEL` | No | `claude-opus-4-6` | Model for API fallback calls |
| `CLI_TIMEOUT_MS` | No | `30000` | Timeout before falling back to API |
| `API_FALLBACK_ENABLED` | No | `true` | Set `false` to disable API fallback (returns 503) |
| `PORT` | No | `3131` | Port the gateway listens on |
| `CLAUDE_OAUTH_CLIENT_ID` | No | - | Enables automatic OAuth token refresh |

## Usage

```bash
# Start the server
npm start

# Start with file watching (auto-restart on changes)
npm run dev
```

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
| `model` | string | No | Model override |
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

`source` is `"cli"` when the subscription CLI handled the request, or `"api"` when it fell back to the Anthropic API.

### `GET /health`

Returns `{"status": "ok"}`. No auth required.

### `GET /health/cli`

Returns CLI auth token status (`ok`, `expiring`, `expired`). No auth required.

## Testing

```bash
npm test
```

## How it works

1. Prompt is written to a temp file
2. PowerShell pipes the file to `claude -p` via `Get-Content | claude`
3. If the CLI succeeds, the response is returned
4. If the CLI fails or times out, the request is retried against the Anthropic API (if enabled)
5. Temp file is cleaned up regardless of outcome

The temp file approach avoids PowerShell's 32KB command-line limit, which large prompts (e.g. batch remediation requests) can exceed.

## License

MIT
