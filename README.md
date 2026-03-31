# @davoxi/mcp-server

MCP (Model Context Protocol) server for the [Davoxi](https://davoxi.com) AI voice agent platform. Lets AI assistants (Claude Code, Cursor, etc.) manage voice businesses, specialist agents, usage analytics, billing, and API keys conversationally.

## Quick Start

```bash
npm install
npm run build
```

### Claude Desktop

Add to your Claude Desktop MCP config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "davoxi": {
      "command": "node",
      "args": ["/path/to/davoxi-mcp/dist/bin/davoxi-mcp.js"],
      "env": {
        "DAVOXI_API_KEY": "sk_your_key_here"
      }
    }
  }
}
```

### Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "davoxi": {
      "command": "node",
      "args": ["/path/to/davoxi-mcp/dist/bin/davoxi-mcp.js"],
      "env": {
        "DAVOXI_API_KEY": "sk_your_key_here"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "davoxi": {
      "command": "node",
      "args": ["/path/to/davoxi-mcp/dist/bin/davoxi-mcp.js"],
      "env": {
        "DAVOXI_API_KEY": "sk_your_key_here"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DAVOXI_API_KEY` | Yes | Your Davoxi API key (starts with `sk_`) |
| `DAVOXI_API_URL` | No | API base URL (default: `https://api.davoxi.com`) |

## Available Tools

### Businesses
- **list_businesses** — List all businesses on your account
- **get_business** — Get details of a specific business
- **create_business** — Create a new business with voice config
- **update_business** — Update business settings
- **delete_business** — Delete a business

### Agents
- **list_agents** — List specialist agents for a business
- **get_agent** — Get details of a specific agent
- **create_agent** — Create a new specialist agent
- **update_agent** — Update agent configuration
- **delete_agent** — Delete an agent

### Analytics & Billing
- **get_usage** — Detailed usage by resource
- **get_usage_summary** — Aggregated usage summary
- **get_subscription** — Current billing subscription
- **list_invoices** — List billing invoices

### Account
- **get_profile** — Current user profile
- **list_api_keys** — List API keys
- **create_api_key** — Create a new API key
- **revoke_api_key** — Revoke an API key

## Development

```bash
npm run dev    # Watch mode (recompiles on change)
npm run build  # Production build
npm start      # Run the server
```

## License

MIT
