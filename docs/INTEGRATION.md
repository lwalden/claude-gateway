# Integrating with claude-gateway

This guide is for developers whose app or service wants to **call** a running
claude-gateway instance. (If you want to *run your own* instance, see the
[README](../README.md) instead.)

claude-gateway exposes a single endpoint — `POST /ask` — that returns Claude
responses from a **Claude subscription** (via the Claude CLI / OAuth). It is
subscription-only: there is no Anthropic API key involved.

---

## 1. What you need from the gateway operator

The gateway is self-hosted — someone runs the instance you want to talk to
(often on their own machine, reachable via a tunnel). Get these two things from
**whoever operates the specific instance you're connecting to**:

| Item | Description |
|------|-------------|
| **Base URL** | e.g. `https://your-gateway-host` — each instance has its own. |
| **Bearer token** | the instance's `GATEWAY_API_KEY`. Treat it as a secret (store it in your own secret manager, never commit it). |

> **Availability:** an instance backed by someone's local subscription is only
> reachable while their host is running. Build for the gateway sometimes being
> unavailable (see [Error handling](#5-error-handling)).

In the examples below, substitute your values for `$BASE_URL` and `$TOKEN`.

---

## 2. Authentication

Every `POST /ask` request must include the bearer token:

```
Authorization: Bearer <token>
```

A missing or invalid token returns `401`.

---

## 3. Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/ask` | Bearer | Ask Claude a question |
| `GET` | `/health` | none | Liveness check |
| `GET` | `/health/cli` | none | Subscription credential status (is the session valid / expiring?) |

The full machine-readable contract is **[`openapi.yaml`](../openapi.yaml)** —
import it into Postman/Insomnia or generate a typed client. Pin to its
`info.version` (currently `0.2.0`); `source`/`model` values changed at `0.2.0`.

---

## 4. `POST /ask`

### Request

`Content-Type: application/json`, body capped at **1 MB**.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `prompt` | string | **yes** | The prompt. Non-empty, ≤ 100,000 chars. |
| `system` | string | no | System prompt, ≤ 100,000 chars. |
| `model` | string | no | Model id (≤ 256 chars), passed to `claude --model`. Defaults to the instance's configured model. |
| `jsonSchema` | object | no | JSON Schema to enforce structured output. When set, `response` is a **JSON string** you must `JSON.parse`. |

### Success — `200`

```json
{
  "response": "…Claude's reply…",
  "source": "cli",
  "model": "subscription",
  "durationMs": 2340
}
```

- `source` is always `"cli"` and `model` is always `"subscription"` (the gateway
  is subscription-only; both fields are retained for backward compatibility).
- If you sent `jsonSchema`, `response` is a JSON **string** — parse it.

### Example

```bash
curl -X POST "$BASE_URL/ask" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Summarize the CAP theorem in one sentence."}'
```

---

## 5. Error handling

| Status | Body | Meaning |
|--------|------|---------|
| `400` | `{ "error": "…" }` | Validation failed; the message names the bad field. |
| `401` | `{ "error": "Unauthorized" }` | Missing/invalid bearer token. |
| `413` | plain text (not JSON) | Body exceeded 1 MB. |
| `500` | `{ "error": "…" }` | Gateway misconfigured (e.g. no key set on the server). |
| `502` | `{ "error": "…", "durationMs": N }` | The CLI call failed — timeout, the instance's subscription not signed in, empty response, etc. **There is no fallback.** Messages are sanitized (no internal detail). |
| `404` | `{ "error": "Not Found" }` | Unknown path/method. |

If you get `502`, check `GET /health/cli` — `status: expired`/`unknown` means the
instance's subscription session needs attention on the operator's side.

---

## 6. Practical notes

- **Synchronous and not instant.** A real model call takes seconds. The server
  has a CLI timeout (~30 s by default), so set your **HTTP client timeout to at
  least 35 s**.
- **No streaming.** You get the full response in one `200`.
- **No server-side rate limiting**, but the subscription has its own usage
  limits. Don't hammer it; **back off on `502`** rather than retrying tightly.
- **Stateless.** No conversation memory — include any context you need in each
  `prompt`. Multi-turn is the caller's responsibility.
- **Subscription-only.** There is no API-key path; availability tracks the
  instance's subscription session and host uptime.

---

## 7. Client snippets

### Node (fetch, Node 18+)

```js
const res = await fetch(`${process.env.BASE_URL}/ask`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.GATEWAY_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ prompt: "List three risks.", system: "Be terse." }),
  signal: AbortSignal.timeout(35_000),
});
if (!res.ok) throw new Error(`gateway ${res.status}: ${await res.text()}`);
const { response, durationMs } = await res.json();
```

### Python (requests)

```python
import os, requests

r = requests.post(
    f"{os.environ['BASE_URL']}/ask",
    headers={"Authorization": f"Bearer {os.environ['GATEWAY_TOKEN']}"},
    json={"prompt": "List three risks.", "system": "Be terse."},
    timeout=35,
)
r.raise_for_status()
data = r.json()
print(data["response"])
```

### Structured output

Send a `jsonSchema`; remember `response` comes back as a JSON **string**:

```js
const body = {
  prompt: "Extract the name and age from: Dana is 31.",
  jsonSchema: {
    type: "object",
    properties: { name: { type: "string" }, age: { type: "integer" } },
    required: ["name", "age"],
  },
};
// … POST as above …
const { response } = await res.json();
const parsed = JSON.parse(response); // { name: "Dana", age: 31 }
```
