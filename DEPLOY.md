# Deploying the multi-company QuickBooks MCP server

This runs the server as an HTTP MCP endpoint in Docker, exposed through a
Cloudflare **named tunnel**. One Intuit app authorizes many QuickBooks
companies; each company is reached at `/mcp/<realmId>` and guarded by a shared
bearer token.

## Architecture

```
MCP client (Claude) ──HTTPS──> Cloudflare edge ──tunnel──> cloudflared ──> qbo-mcp:3000
                                                                              │
                                                              data volume (companies.json)
```

- `qbo-mcp` is **not** published to the host — only `cloudflared` reaches it over the compose network.
- Refresh tokens persist in the `qbo-data` volume (`/app/data/companies.json`), so they survive restarts and rotation.

## 1. Prerequisites

- Docker + Docker Compose
- A Cloudflare account with a domain on Cloudflare
- An Intuit Developer app (production or sandbox keys)

## 2. Create the Cloudflare named tunnel

1. Cloudflare **Zero Trust → Networks → Tunnels → Create a tunnel** (type: *Cloudflared*).
2. Name it (e.g. `qbo-mcp`) and copy the **tunnel token** → this is `TUNNEL_TOKEN`.
3. Add a **Public Hostname**: e.g. `qbo-mcp.yourdomain.com` → Service `HTTP` → `qbo-mcp:3000`.
   (That hostname is your `PUBLIC_BASE_URL`.)

## 3. Register the OAuth redirect URI in Intuit

In your Intuit app → **Keys & credentials / Redirect URIs**, add exactly:

```
https://<PUBLIC_BASE_URL>/oauth/callback
```

## 4. Configure environment

```bash
cp .env.docker.example .env.docker
# then fill in: QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_ENVIRONMENT,
#               PUBLIC_BASE_URL, MCP_BEARER_TOKEN (openssl rand -hex 32), TUNNEL_TOKEN
```

`.env.docker` is gitignored — keep your secrets there.

## 5. Build & run

```bash
docker compose up --build -d
docker compose logs -f qbo-mcp
```

Health check: `https://<PUBLIC_BASE_URL>/health` → `{"status":"ok","companies":0}`.

## 6. Connect a company (OAuth onboarding)

Open in a browser (the `?token=` is your `MCP_BEARER_TOKEN`):

```
https://<PUBLIC_BASE_URL>/connect?token=<MCP_BEARER_TOKEN>
```

Authorize the QuickBooks company. On success the page shows the company's
`realmId` and its MCP URL. The refresh token is saved to the volume. Repeat for
each company.

List connected companies any time:

```bash
curl -H "Authorization: Bearer <MCP_BEARER_TOKEN>" https://<PUBLIC_BASE_URL>/companies
```

## 7. Add a company to your MCP client

Each company is a separate MCP server entry (same URL base, different realm):

```bash
claude mcp add --transport http qbo-<name> \
  https://<PUBLIC_BASE_URL>/mcp/<realmId> \
  --header "Authorization: Bearer <MCP_BEARER_TOKEN>"
```

Then call e.g. `get_company_info` to confirm it returns that company.

## Notes

- **Auth:** a single shared bearer token guards `/mcp/*`, `/companies`, and `/connect`. Rotate it by changing `MCP_BEARER_TOKEN` and restarting.
- **Local single-company mode** still works unchanged: run without `MCP_TRANSPORT`/`PORT` for stdio using the legacy `QUICKBOOKS_*` `.env` vars.
- **Out of scope (future):** per-company `DISABLE_*` flags (currently global), encrypting the token store at rest, automating the Cloudflare/Intuit dashboard steps.
