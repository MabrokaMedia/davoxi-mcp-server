# @davoxi/mcp-server

MCP (Model Context Protocol) server for the [Davoxi](https://davoxi.com) AI voice agent platform. Lets AI assistants manage voice businesses, specialist agents, call logs, webhooks, usage analytics, billing, and API keys conversationally.

Works with **Claude Code**, **Claude Desktop**, **Cursor**, **Windsurf**, and any MCP-compatible client.

## Installation

### Option 1: npx (recommended, zero install)

No installation needed. Just add the config to your AI tool and it runs automatically.

### Option 2: Global install

```bash
npm install -g @davoxi/mcp-server
```

### Option 3: From source

```bash
git clone https://github.com/MabrokaMedia/davoxi-mcp-server.git
cd davoxi-mcp-server
npm install && npm run build
```

## Authentication

### Browser Login (recommended)

The easiest way to authenticate — no API key copy-paste needed:

```bash
npx @davoxi/mcp-server auth login
```

This opens your browser to the Davoxi dashboard where you log in and click "Authorize". The API key is created automatically and saved to `~/.davoxi/mcp.json`.

Other auth commands:

```bash
npx @davoxi/mcp-server auth status   # Check current auth state
npx @davoxi/mcp-server auth logout   # Clear saved credentials
```

### Manual API Key

Alternatively, get an API key from your [Davoxi Dashboard](https://app.davoxi.com/settings/api-keys) and set it as an environment variable.

**Key resolution order:** `DAVOXI_API_KEY` env var > `~/.davoxi/mcp.json` (from browser login)

## Connecting to Your AI Tool

### Prerequisites

1. **Authenticate**: Run `npx @davoxi/mcp-server auth login` (or get an API key manually)
2. **Node.js 20+** installed on your machine

### Claude Code

Run this command in your terminal:

```bash
claude mcp add davoxi -- npx -y @davoxi/mcp-server
```

Then set your API key in the environment. Or add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "davoxi": {
      "command": "npx",
      "args": ["-y", "@davoxi/mcp-server"],
      "env": {
        "DAVOXI_API_KEY": "sk_your_key_here"
      }
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "davoxi": {
      "command": "npx",
      "args": ["-y", "@davoxi/mcp-server"],
      "env": {
        "DAVOXI_API_KEY": "sk_your_key_here"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "davoxi": {
      "command": "npx",
      "args": ["-y", "@davoxi/mcp-server"],
      "env": {
        "DAVOXI_API_KEY": "sk_your_key_here"
      }
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "davoxi": {
      "command": "npx",
      "args": ["-y", "@davoxi/mcp-server"],
      "env": {
        "DAVOXI_API_KEY": "sk_your_key_here"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DAVOXI_API_KEY` | No* | - | Your API key (starts with `sk_`). *Not needed if you used `auth login` |
| `DAVOXI_API_URL` | No | `https://api.davoxi.com` | Custom API endpoint (must be HTTPS or localhost) |

## Available Tools (27)

### Businesses (5 tools)
| Tool | Description |
|---|---|
| `list_businesses` | List all businesses on your account |
| `get_business` | Get details of a specific business (voice config, master config, phone numbers) |
| `create_business` | Create a new business with voice model, language, personality, and temperature settings |
| `update_business` | Update business name, phone numbers, voice config, or master config |
| `delete_business` | Permanently delete a business and all its agents (requires `confirm=true`) |

### Agents (7 tools)
| Tool | Description |
|---|---|
| `list_agents` | List all specialist agents for a business |
| `get_agent` | Get agent details including system prompt, tools, knowledge sources, and stats |
| `create_agent` | Create a specialist agent with system prompt, tools, knowledge sources, and trigger tags |
| `update_agent` | Update an agent's configuration (description, prompt, tools, tags, enabled) |
| `delete_agent` | Permanently delete an agent (requires `confirm=true`) |
| `duplicate_agent` | Copy an existing agent — useful for creating variations or testing changes safely |

### Call Logs (2 tools)
| Tool | Description |
|---|---|
| `list_call_logs` | List calls with filters: date range, status (completed/missed/failed), agent, pagination |
| `get_call_log` | Get full call details: transcript, recording URL, duration, summary |

### Agent Testing (1 tool)
| Tool | Description |
|---|---|
| `test_agent_chat` | Send a test message to a deployed business as if you were a real WhatsApp caller and get every reply back. Exercises the full Brain → Master Orchestrator → Specialist code path over the same WebSocket the dashboard test-chat uses — no real Twilio message is sent. Pass the same `caller_id` across calls for multi-turn continuity. |

### Webhooks (4 tools)
| Tool | Description |
|---|---|
| `list_webhooks` | List all webhooks for a business |
| `create_webhook` | Subscribe to events (call.started, call.completed, agent.invoked, etc.) |
| `update_webhook` | Update webhook URL, events, or enabled status |
| `delete_webhook` | Delete a webhook (requires `confirm=true`) |

### Phone Numbers (1 tool)
| Tool | Description |
|---|---|
| `list_phone_numbers` | List all phone numbers with business assignment and capabilities |

### Analytics & Billing (4 tools)
| Tool | Description |
|---|---|
| `get_usage` | Detailed usage by resource (calls, minutes, costs per business/agent) |
| `get_usage_summary` | Aggregated usage summary for current billing period |
| `get_subscription` | Current plan, status, billing period, cancellation status |
| `list_invoices` | All invoices with amounts, status, and PDF download URLs |

### Account (4 tools)
| Tool | Description |
|---|---|
| `get_profile` | Current user profile (ID, email, name) |
| `list_api_keys` | List API keys (prefix only, full key never shown) |
| `create_api_key` | Create a new API key (full key shown only once — save it!) |
| `revoke_api_key` | Permanently revoke an API key (requires `confirm=true`) |

## Example Workflows

### Set up a new business with agents

```
You: Create a business called "Acme Support" with voice "nova", language "en-US",
     and personality "You are a friendly, professional customer service agent."

You: Create an agent for that business:
     - Description: "Handles appointment scheduling"
     - System prompt: "You help callers schedule, reschedule, or cancel appointments.
       Always confirm the date, time, and service before booking."
     - Trigger tags: ["appointment", "schedule", "booking", "reschedule", "cancel"]

You: Create another agent for billing questions with trigger tags ["billing", "invoice", "payment"]

You: List all agents for Acme Support to verify everything looks good
```

### Monitor call activity

```
You: Show me all calls for business biz_abc123 from the last 7 days

You: How many calls were missed vs completed this week?

You: Show me the details and transcript for call call_xyz789
```

### Set up webhook notifications

```
You: Create a webhook for business biz_abc123 that sends to
     https://hooks.example.com/davoxi with events: call.completed, call.missed

You: List all webhooks for that business to verify
```

### Test an agent end-to-end without WhatsApp

```
You: I just deployed agent agent_xyz on biz_abc123 — try asking it
     "what's your weekend availability?" and tell me what it replies

You: Now follow up with "great, can I book Saturday at 2pm?" using the
     same caller_id so it remembers the prior turn
```

`test_agent_chat` runs through the same Brain → Specialist chain that real Twilio traffic does, so the reply you get back is exactly what a real caller would receive. The Brain may emit a filler ("one moment please…") followed by the Specialist's final answer — both come back in the `replies` array, in order.

### Duplicate and modify an agent

```
You: Duplicate the appointment booking agent from Acme Support

You: Update the copy's system prompt to handle Spanish-speaking callers
     and change trigger tags to ["cita", "reservar", "cancelar"]

You: Enable the new agent
```

## Security

### Authentication

- All API calls require a valid `DAVOXI_API_KEY` (Bearer token)
- API keys are scoped to your account — they can only access your businesses, agents, and data
- Keys start with `sk_` prefix for easy identification
- Full API key is only shown once at creation — store it securely

### Browser Login Security

- **CSRF protection** — random 64-character state parameter validated on callback
- **Localhost callback** — the temporary server binds to `127.0.0.1` only (unreachable from network)
- **Single-use** — callback server closes immediately after receiving one response
- **5-minute timeout** — abandoned login flows are automatically cleaned up
- **File permissions** — `~/.davoxi/mcp.json` created with mode `0o600` (owner read/write only)
- **No open redirect** — login redirect validated to start with `/`

### Transport Security

- **HTTPS enforced** — the server validates that `DAVOXI_API_URL` uses HTTPS (http://localhost allowed for development only)
- **Stdio transport** — the MCP server communicates via stdin/stdout, not over the network. Your API key never leaves your machine except in authenticated API calls to Davoxi
- **No open ports** — the server doesn't listen on any network port

### Data Protection

- API key prefixes are returned for identification, but full keys are never re-exposed after creation
- **SSRF protection** — agent tool endpoints are validated to prevent calls to private/internal IPs (127.*, 10.*, 192.168.*, 169.254.*, etc.)
- **IPv6 private ranges blocked** (::1, fe80:, fc00:, fd00:)
- Blocked hostnames: localhost, ip6-localhost (in tool endpoint validation)

### Destructive Operation Safety

All destructive operations require explicit `confirm=true` parameter:
- `delete_business` — warns about cascading deletion of agents, phone assignments, and webhooks
- `delete_agent` — suggests disabling instead (`enabled=false` is reversible)
- `revoke_api_key` — warns about immediate access loss for integrations
- `delete_webhook` — confirms permanent removal

### Best Practices

1. **Use separate API keys** for different environments (production, staging, development)
2. **Name your API keys** (`create_api_key` with `name` parameter) for easy identification
3. **Rotate keys regularly** — create a new key, update integrations, then revoke the old one
4. **Use webhooks over polling** — subscribe to events instead of repeatedly calling `list_call_logs`
5. **Disable before deleting** — use `update_agent` with `enabled=false` before permanently deleting

### Webhook Security

- Webhook responses include a `secret` field at creation — use it to verify payload signatures
- Endpoints must respond with 2xx within 10 seconds
- Failed deliveries are retried up to 3 times with exponential backoff
- Only HTTPS webhook URLs are accepted

## Development

```bash
npm run dev    # Watch mode (recompiles on change)
npm run build  # Production build
npm start      # Run the server
npm test       # Run tests
```

## License

MIT
