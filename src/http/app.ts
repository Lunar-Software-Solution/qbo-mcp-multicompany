import express, { Request, Response, NextFunction } from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import OAuthClient from "intuit-oauth";
import { createQuickbooksMcpServer } from "../server/build-server.js";
import { runWithCompany } from "../clients/company-context.js";
import { companyStore } from "../clients/company-store.js";
import { QuickbooksClient } from "../clients/quickbooks-client.js";
import { getQuickbooksCompanyInfo } from "../handlers/get-quickbooks-company-info.handler.js";
import { ADMIN_HTML } from "./admin-page.js";

// ── Config ───────────────────────────────────────────────────────────────────
const CLIENT_ID = process.env.QBO_CLIENT_ID || process.env.QUICKBOOKS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.QBO_CLIENT_SECRET || process.env.QUICKBOOKS_CLIENT_SECRET || "";
const ENVIRONMENT = process.env.QBO_ENVIRONMENT || process.env.QUICKBOOKS_ENVIRONMENT || "sandbox";
const BEARER_TOKEN = process.env.MCP_BEARER_TOKEN || "";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const DEFAULT_REALM = process.env.QBO_DEFAULT_REALM || process.env.QUICKBOOKS_REALM_ID;

const REDIRECT_URI = PUBLIC_BASE_URL
  ? `${PUBLIC_BASE_URL}/oauth/callback`
  : "http://localhost:8000/callback";

/** Constant-time string compare that tolerates length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function isKnownCompany(realmId: string): boolean {
  return !!companyStore.get(realmId) || realmId === DEFAULT_REALM;
}

// ── App ────────────────────────────────────────────────────────────────────
export function createHttpApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // Active MCP sessions: sessionId → transport. Each is bound to one company.
  const transports: Record<string, StreamableHTTPServerTransport> = {};
  // Pending OAuth state values (CSRF protection for the onboarding flow).
  const pendingStates = new Set<string>();

  // Bearer auth for MCP + admin endpoints (header form).
  function requireBearer(req: Request, res: Response, next: NextFunction) {
    if (!BEARER_TOKEN) {
      res.status(503).json({ error: "Server not configured: MCP_BEARER_TOKEN is not set." });
      return;
    }
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token || !safeEqual(token, BEARER_TOKEN)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }

  // ── Health ─────────────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", companies: companyStore.list().length });
  });

  // ── Admin dashboard (static shell; all data calls are bearer-gated) ──────────
  app.get("/admin", (_req, res) => {
    res.type("html").send(ADMIN_HTML);
  });

  // ── List connected companies (admin) ─────────────────────────────────────────
  app.get("/companies", requireBearer, (_req, res) => {
    const list = companyStore.list().map((c) => ({
      realmId: c.realmId,
      environment: c.environment,
      displayName: c.displayName,
      connectedAt: c.connectedAt,
      source: "store",
      mcpUrl: `${PUBLIC_BASE_URL || ""}/mcp/${c.realmId}`,
    }));
    // Surface the legacy env-default company (single-company mode) if configured
    // and not already onboarded into the store.
    if (DEFAULT_REALM && !companyStore.get(DEFAULT_REALM)) {
      list.push({
        realmId: DEFAULT_REALM,
        environment: ENVIRONMENT,
        displayName: undefined,
        connectedAt: undefined,
        source: "env",
        mcpUrl: `${PUBLIC_BASE_URL || ""}/mcp/${DEFAULT_REALM}`,
      });
    }
    res.json({ companies: list });
  });

  // ── Disconnect a company ─────────────────────────────────────────────────────
  app.delete("/companies/:realmId", requireBearer, (req, res) => {
    const realmId = String(req.params.realmId);
    const removed = companyStore.remove(realmId);
    QuickbooksClient.forget(realmId);
    res.json({ ok: removed });
  });

  // ── Health check: force a token refresh + a live QBO ping ────────────────────
  app.get("/companies/:realmId/health", requireBearer, async (req, res) => {
    const realmId = String(req.params.realmId);
    if (!isKnownCompany(realmId)) {
      res.status(404).json({ ok: false, error: "Company is not connected." });
      return;
    }
    try {
      const info: any = await runWithCompany(realmId, async () => {
        const qbo = await QuickbooksClient.getInstance(); // refreshes the access token if needed
        return await new Promise((resolve, reject) =>
          (qbo as any).getCompanyInfo(realmId, (e: any, c: any) => (e ? reject(e) : resolve(c)))
        );
      });
      const companyName = info?.CompanyName;
      if (companyName) {
        try { companyStore.setDisplayName(realmId, companyName); } catch { /* best effort */ }
      }
      res.json({
        ok: true,
        companyName,
        environment: companyStore.get(realmId)?.environment || ENVIRONMENT,
      });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Rich company details (read-only): CompanyInfo + home currency ────────────
  app.get("/companies/:realmId/info", requireBearer, async (req, res) => {
    const realmId = String(req.params.realmId);
    if (!isKnownCompany(realmId)) {
      res.status(404).json({ health: "error", error: "Company is not connected." });
      return;
    }
    try {
      const payload = await runWithCompany(realmId, async () => {
        const infoResp = await getQuickbooksCompanyInfo(realmId);
        if (infoResp.isError || !infoResp.result) {
          throw new Error(infoResp.error || "Failed to load company info");
        }
        const ci: any = infoResp.result;

        // Home currency comes from Preferences (no handler for it) — raw API call,
        // same pattern as the attachable upload handler.
        let currency: string | undefined;
        let multiCurrency: boolean | undefined;
        try {
          const creds = await QuickbooksClient.getAuthCredentials();
          const base = creds.isSandbox
            ? "https://sandbox-quickbooks.api.intuit.com"
            : "https://quickbooks.api.intuit.com";
          const pr = await fetch(`${base}/v3/company/${realmId}/preferences?minorversion=65`, {
            headers: { Authorization: `Bearer ${creds.accessToken}`, Accept: "application/json" },
          });
          if (pr.ok) {
            const pj: any = await pr.json();
            const prefs = pj.Preferences || pj;
            currency = prefs?.CurrencyPrefs?.HomeCurrency?.value;
            multiCurrency = prefs?.CurrencyPrefs?.MultiCurrencyEnabled;
          }
        } catch { /* currency is best-effort */ }

        const nv: Record<string, string> = {};
        (ci.NameValue || []).forEach((p: any) => { if (p?.Name) nv[p.Name] = p.Value; });
        const addr = ci.CompanyAddr || ci.LegalAddr || {};

        return {
          realmId,
          environment: companyStore.get(realmId)?.environment || ENVIRONMENT,
          health: "ok",
          companyName: ci.CompanyName,
          legalName: ci.LegalName,
          address: {
            line1: addr.Line1,
            city: addr.City,
            region: addr.CountrySubDivisionCode,
            postalCode: addr.PostalCode,
            country: addr.Country,
          },
          country: ci.Country,
          email: ci.Email?.Address,
          phone: ci.PrimaryPhone?.FreeFormNumber,
          webAddr: ci.WebAddr?.URI,
          fiscalYearStartMonth: ci.FiscalYearStartMonth,
          currency,
          multiCurrency,
          subscriptionStatus: nv.SubscriptionStatus,
          offeringSku: nv.OfferingSku,
          industry: nv.QBOIndustryType || nv.IndustryType,
        };
      });

      if (payload.companyName) {
        try { companyStore.setDisplayName(realmId, payload.companyName); } catch { /* best effort */ }
      }
      res.json(payload);
    } catch (err) {
      res.json({ health: "error", error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── OAuth onboarding: start ───────────────────────────────────────────────────
  // Browser-friendly: protect with ?token=<bearer> since browsers can't easily
  // send an Authorization header for a top-level navigation.
  app.get("/connect", (req, res) => {
    if (!BEARER_TOKEN || !safeEqual(String(req.query.token || ""), BEARER_TOKEN)) {
      res.status(401).send("Unauthorized. Append ?token=<MCP_BEARER_TOKEN>.");
      return;
    }
    if (!CLIENT_ID || !CLIENT_SECRET) {
      res.status(503).send("Server missing QBO_CLIENT_ID / QBO_CLIENT_SECRET.");
      return;
    }
    const oauthClient = new OAuthClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      environment: ENVIRONMENT,
      redirectUri: REDIRECT_URI,
    });
    const state = randomUUID();
    pendingStates.add(state);
    const authUri = oauthClient
      .authorizeUri({ scope: [OAuthClient.scopes.Accounting as string], state })
      .toString();
    res.redirect(authUri);
  });

  // ── OAuth onboarding: callback (Intuit redirects the browser here) ───────────
  app.get("/oauth/callback", async (req, res) => {
    try {
      const state = String(req.query.state || "");
      if (!pendingStates.has(state)) {
        res.status(400).send("Invalid or expired OAuth state.");
        return;
      }
      pendingStates.delete(state);

      const oauthClient = new OAuthClient({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        environment: ENVIRONMENT,
        redirectUri: REDIRECT_URI,
      });
      const authResponse = await oauthClient.createToken(req.url);
      const token = authResponse.token as unknown as { refresh_token?: string; realmId?: string };
      const realmId = token.realmId || String(req.query.realmId || "");
      const refreshToken = token.refresh_token;
      if (!realmId || !refreshToken) {
        res.status(500).send("OAuth succeeded but no realmId / refresh token returned.");
        return;
      }
      companyStore.upsert({ realmId, refreshToken, environment: ENVIRONMENT });
      const mcpUrl = `${PUBLIC_BASE_URL || ""}/mcp/${realmId}`;
      res.status(200).send(`
        <html><body style="font-family:Arial, sans-serif;max-width:640px;margin:48px auto;">
          <h2 style="color:#2E8B57;">✓ Company connected</h2>
          <p><strong>Realm ID:</strong> ${realmId}</p>
          <p><strong>Environment:</strong> ${ENVIRONMENT}</p>
          <p>Add this company to your MCP client as:</p>
          <pre style="background:#f5f5f5;padding:12px;border-radius:6px;">${mcpUrl}</pre>
          <p>Send the header <code>Authorization: Bearer &lt;your token&gt;</code>.</p>
          <p style="margin-top:28px;"><a href="/admin" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">← Back to admin</a></p>
        </body></html>
      `);
    } catch (err) {
      console.error("[oauth/callback] error:", err);
      res.status(500).send("OAuth callback failed. Check server logs.");
    }
  });

  // ── MCP endpoint, scoped to a company by route param ─────────────────────────
  app.post("/mcp/:realmId", requireBearer, async (req, res) => {
    const realmId = String(req.params.realmId);
    if (!isKnownCompany(realmId)) {
      res.status(404).json({ error: `Company ${realmId} is not connected. Visit /connect to authorize it.` });
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports[sessionId] : undefined;

    if (!transport) {
      if (sessionId || !isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: no valid session ID for a non-initialize request." },
          id: null,
        });
        return;
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => { transports[sid] = transport!; },
      });
      transport.onclose = () => {
        if (transport!.sessionId) delete transports[transport!.sessionId];
      };
      const server = createQuickbooksMcpServer();
      await server.connect(transport);
    }

    await runWithCompany(realmId, () => transport!.handleRequest(req, res, req.body));
  });

  // SSE stream + session termination reuse the established session.
  const sessionRequestHandler = async (req: Request, res: Response) => {
    const realmId = String(req.params.realmId);
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports[sessionId] : undefined;
    if (!transport) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await runWithCompany(realmId, () => transport.handleRequest(req, res));
  };
  app.get("/mcp/:realmId", requireBearer, sessionRequestHandler);
  app.delete("/mcp/:realmId", requireBearer, sessionRequestHandler);

  return app;
}
