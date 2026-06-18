# Connecting MCP clients

This server is a **remote, multi-company** QuickBooks Online MCP server, exposed over HTTPS through a Cloudflare named tunnel and protected by **Cloudflare Access (service token)** + a **bearer token**. This guide shows how to connect it from the common MCP clients.

## What you need

| Value | Where to get it |
|---|---|
| **Base URL** | your tunnel host, e.g. `https://qbo.example.com` |
| **`MCP_BEARER_TOKEN`** | from `.env.docker` (the admin token you paste into `/admin`) |
| **`CF-Access-Client-Id`** | the Cloudflare Access **service token** ID |
| **`CF-Access-Client-Secret`** | the Cloudflare Access service token secret |
| **Realm ID(s)** | each connected company's realm, shown in `/admin` or `GET /companies` |

> ⚠️ Never commit these into a shared repo. Use placeholders and keep real values local.

Every request must carry **all three** headers:

```
CF-Access-Client-Id: <CF_ACCESS_CLIENT_ID>
CF-Access-Client-Secret: <CF_ACCESS_CLIENT_SECRET>
Authorization: Bearer <MCP_BEARER_TOKEN>
```

## Two URL modes

| Mode | URL | How you pick the company |
|---|---|---|
| **Single connection** (recommended) | `https://<HOST>/mcp` | pass a `company: "<realmId>"` argument on each tool call (omit → default company) |
| **Per-company** | `https://<HOST>/mcp/<realmId>` | bound to that one company; strongest isolation |

HTTP-native clients (Claude Code, Cursor, VS Code) can send headers directly. Stdio-only clients (Claude Desktop, OpenAI Codex) need the **`mcp-remote`** bridge, which forwards `--header` values.

---

## Claude Code (CLI)

```bash
claude mcp add --transport http --scope user qbo https://<HOST>/mcp \
  --header "CF-Access-Client-Id: <CF_ACCESS_CLIENT_ID>" \
  --header "CF-Access-Client-Secret: <CF_ACCESS_CLIENT_SECRET>" \
  --header "Authorization: Bearer <MCP_BEARER_TOKEN>"
```

Per-company instead: use `https://<HOST>/mcp/<realmId>` and a name like `qbo-lunar`. Restart Claude Code after adding so the tools load. Verify with `claude mcp list` (should show `✔ Connected`).

## Cursor

`.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "qbo": {
      "url": "https://<HOST>/mcp",
      "headers": {
        "CF-Access-Client-Id": "<CF_ACCESS_CLIENT_ID>",
        "CF-Access-Client-Secret": "<CF_ACCESS_CLIENT_SECRET>",
        "Authorization": "Bearer <MCP_BEARER_TOKEN>"
      }
    }
  }
}
```

## VS Code (GitHub Copilot / MCP)

`.vscode/mcp.json`:

```json
{
  "servers": {
    "qbo": {
      "type": "http",
      "url": "https://<HOST>/mcp",
      "headers": {
        "CF-Access-Client-Id": "<CF_ACCESS_CLIENT_ID>",
        "CF-Access-Client-Secret": "<CF_ACCESS_CLIENT_SECRET>",
        "Authorization": "Bearer <MCP_BEARER_TOKEN>"
      }
    }
  }
}
```

## Claude Desktop

Claude Desktop runs MCP servers as local processes (stdio), so use the **`mcp-remote`** bridge. Open **Settings → Developer → Edit Config** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "qbo": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "https://<HOST>/mcp",
        "--header", "CF-Access-Client-Id: <CF_ACCESS_CLIENT_ID>",
        "--header", "CF-Access-Client-Secret: <CF_ACCESS_CLIENT_SECRET>",
        "--header", "Authorization: Bearer <MCP_BEARER_TOKEN>"
      ]
    }
  }
}
```

Restart Claude Desktop. Requires Node.js on the machine.

## OpenAI Codex (CLI)

Codex runs MCP servers over stdio, so use the `mcp-remote` bridge. In `~/.codex/config.toml`:

```toml
[mcp_servers.qbo]
command = "npx"
args = [
  "-y", "mcp-remote", "https://<HOST>/mcp",
  "--header", "CF-Access-Client-Id: <CF_ACCESS_CLIENT_ID>",
  "--header", "CF-Access-Client-Secret: <CF_ACCESS_CLIENT_SECRET>",
  "--header", "Authorization: Bearer <MCP_BEARER_TOKEN>"
]
```

> Codex's MCP config keys evolve — if `[mcp_servers.*]` differs in your version, check `codex --help` / current docs; the bridge command itself is the same.

## Claude Desktop / claude.ai (OAuth custom connector)

Connector UIs authenticate via **OAuth** (they can't send static headers). For this, the deployment exposes a separate **Managed-OAuth hostname** (a Cloudflare Access app with Managed OAuth enabled — e.g. `https://qbo-mcp.example.com/mcp`). Adding it is one click, **no headers**:

1. Settings → **Connectors → Add custom connector**.
2. Enter the **OAuth MCP URL**, e.g. `https://qbo-mcp.example.com/mcp`.
3. Save → a browser window opens to the **Cloudflare Access login** (your IdP / Google) → approve.
4. Claude self-registers via **Dynamic Client Registration** and connects; tools load.

No `CF-Access-Client-*` or bearer headers needed — Cloudflare Access runs the OAuth at the edge (the endpoint returns `401` with `WWW-Authenticate: … resource_metadata=…` pointing Claude at Access's OAuth discovery).

> **Two endpoints:** use the **OAuth hostname** (`qbo-mcp.…`) for connector UIs (Claude Desktop / claude.ai); header-capable clients (Claude Code, Cursor, VS Code) and machine clients use the **service-token hostname/path** (`<HOST>/mcp`) with the headers above. Both hit the same server/companies.

## Generic stdio fallback (any MCP client)

Any client that only supports stdio MCP servers can use the bridge:

```bash
npx -y mcp-remote https://<HOST>/mcp \
  --header "CF-Access-Client-Id: <CF_ACCESS_CLIENT_ID>" \
  --header "CF-Access-Client-Secret: <CF_ACCESS_CLIENT_SECRET>" \
  --header "Authorization: Bearer <MCP_BEARER_TOKEN>"
```

---

## Using the tools

- **Discover companies:** call **`list_companies`** (no args) to get the connected `realmId`s + names this server can act on.
- **Pick a company per call** (single-connection mode): pass `company: "<realmId>"` in the tool arguments. Example: `get_company_info` with `{ "company": "1234567890123456" }`.
- Omit `company` to use the connection's default company.
- Per-company connections (`/mcp/<realmId>`) ignore the `company` arg — they're already bound.

## Verifying

- `GET https://<HOST>/health` → `{"status":"ok", ...}` (no auth needed).
- A `get_company_info` call should return the company name/address.
- 401 → bad/missing `Authorization` bearer. 403 / Access login page → missing/invalid `CF-Access-Client-*` headers.

## Security notes

- The bearer token and service token are secrets — store them in each client's local config only, never in a shared repo.
- Rotate the bearer by changing `MCP_BEARER_TOKEN` and restarting the container; rotate the service token in Cloudflare Zero Trust.
- The admin UI (`/admin`) is separately protected by **Cloudflare Access + your Gmail SSO**; `/mcp` is protected by the **service token** so non-interactive clients can connect.
