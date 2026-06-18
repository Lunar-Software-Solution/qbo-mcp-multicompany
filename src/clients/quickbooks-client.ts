import dotenv from "dotenv";
import QuickBooks from "node-quickbooks";
import OAuthClient from "intuit-oauth";
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import { currentRealmId } from "./company-context.js";
import { companyStore } from "./company-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve .env relative to the installed module (../../.env from dist/clients/).
dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), override: true });

process.on('uncaughtException', (err) => {
  console.error('[qbo-client] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[qbo-client] unhandledRejection:', reason);
});

// ── App-level credentials (shared across every company) ──────────────────────
// One Intuit app authorizes many QuickBooks companies. Prefer the new QBO_*
// names; fall back to the legacy QUICKBOOKS_* names for backward compatibility.
const client_id = process.env.QBO_CLIENT_ID || process.env.QUICKBOOKS_CLIENT_ID;
const client_secret = process.env.QBO_CLIENT_SECRET || process.env.QUICKBOOKS_CLIENT_SECRET;
const default_environment = process.env.QBO_ENVIRONMENT || process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
const redirect_uri =
  process.env.QBO_REDIRECT_URI ||
  process.env.QUICKBOOKS_REDIRECT_URI ||
  (process.env.PUBLIC_BASE_URL
    ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/oauth/callback`
    : 'http://localhost:8000/callback');

// The single-company / stdio fallback realm.
const default_realm = process.env.QBO_DEFAULT_REALM || process.env.QUICKBOOKS_REALM_ID;
const default_refresh_token = process.env.QBO_REFRESH_TOKEN || process.env.QUICKBOOKS_REFRESH_TOKEN;

if (!client_id || !client_secret) {
  throw Error("QBO_CLIENT_ID and QBO_CLIENT_SECRET (or legacy QUICKBOOKS_*) must be set in environment variables");
}

export class QuickbooksClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private refreshToken?: string;
  private realmId?: string;
  private readonly environment: string;
  private accessToken?: string;
  private accessTokenExpiry?: Date;
  private quickbooksInstance?: QuickBooks;
  private oauthClient: OAuthClient;
  private isAuthenticating: boolean = false;
  private redirectUri: string;

  private static readonly TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

  private refreshInFlight?: Promise<{ access_token: string; expires_in: number }>;
  private authInFlight?: Promise<QuickBooks>;

  // ── Per-company instance registry ──────────────────────────────────────────
  // Replaces the old module-level singleton. Each realmId gets its own client
  // with its own token cache and in-flight-refresh guard.
  private static registry = new Map<string, QuickbooksClient>();

  /**
   * Get (or lazily build + cache) the client for a specific company. Credentials
   * come from the shared Intuit app; the refresh token comes from the company
   * store, or — for the legacy default realm — from the environment.
   */
  static forRealm(realmId: string): QuickbooksClient {
    const cached = QuickbooksClient.registry.get(realmId);
    if (cached) return cached;

    const record = companyStore.get(realmId);
    let refreshToken = record?.refreshToken;
    let environment = record?.environment || default_environment;

    if (!refreshToken && realmId === default_realm) {
      // Legacy single-company mode: seed from env.
      refreshToken = default_refresh_token;
      environment = default_environment;
    }

    if (!refreshToken) {
      throw new Error(`Company ${realmId} is not connected. Authorize it at /connect first.`);
    }

    const client = new QuickbooksClient({
      clientId: client_id!,
      clientSecret: client_secret!,
      refreshToken,
      realmId,
      environment,
      redirectUri: redirect_uri,
    });
    QuickbooksClient.registry.set(realmId, client);
    return client;
  }

  /** Drop a company's cached client (e.g. after disconnect), forcing a rebuild. */
  static forget(realmId: string): void {
    QuickbooksClient.registry.delete(realmId);
  }

  /** Resolve the company for the current request: async context, else env default. */
  private static resolveRealmId(): string {
    const realmId = currentRealmId() || default_realm;
    if (!realmId) {
      throw new Error(
        "No company specified. Call the `list_companies` tool to see available companies, then pass `company: \"<realmId>\"` on your tool call."
      );
    }
    return realmId;
  }

  constructor(config: {
    clientId: string;
    clientSecret: string;
    refreshToken?: string;
    realmId?: string;
    environment: string;
    redirectUri: string;
  }) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.refreshToken = config.refreshToken;
    this.realmId = config.realmId;
    this.environment = config.environment;
    this.redirectUri = config.redirectUri;
    this.oauthClient = new OAuthClient({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      environment: this.environment,
      redirectUri: this.redirectUri,
    });
  }

  private isTokenExpiredOrExpiringSoon(): boolean {
    if (!this.accessToken || !this.accessTokenExpiry) return true;
    return this.accessTokenExpiry <= new Date(Date.now() + QuickbooksClient.TOKEN_REFRESH_BUFFER_MS);
  }

  private async startOAuthFlow(): Promise<void> {
    if (this.isAuthenticating) {
      return;
    }

    this.isAuthenticating = true;
    const port = 8000;

    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        console.log(`[auth-server] ${req.method} ${req.url}`);

        if (!req.url?.startsWith('/callback')) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found. Waiting for QuickBooks OAuth callback at /callback');
          return;
        }

        {
          try {
            const response = await this.oauthClient.createToken(req.url);
            const tokens = response.token;

            this.refreshToken = tokens.refresh_token;
            this.realmId = tokens.realmId;
            this.saveTokensToEnv();
            // Also seed the company store so the server can serve this company.
            try {
              if (this.realmId && this.refreshToken) {
                companyStore.upsert({ realmId: this.realmId, refreshToken: this.refreshToken, environment: this.environment });
              }
            } catch { /* best effort */ }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;margin:0;font-family:Arial, sans-serif;background-color:#f5f5f5;">
                  <h2 style="color: #2E8B57;">✓ Successfully connected to QuickBooks!</h2>
                  <p>You can close this window now.</p>
                </body>
              </html>
            `);

            setTimeout(() => {
              server.close();
              this.isAuthenticating = false;
              resolve();
            }, 1000);
          } catch (error) {
            console.error('Error during token creation:', error);
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`<html><body><h2 style="color:#d32f2f;">Error connecting to QuickBooks</h2><p>Check the console for details.</p></body></html>`);
            this.isAuthenticating = false;
            reject(error);
          }
        }
      });

      server.listen(port, '::', async () => {
        const addr = server.address();
        console.log(`[auth-server] Listening on ${typeof addr === 'string' ? addr : `${addr?.address}:${addr?.port}`} (family: ${typeof addr === 'object' ? addr?.family : 'n/a'})`);

        const authUri = this.oauthClient.authorizeUri({
          scope: [OAuthClient.scopes.Accounting as string],
          state: 'testState'
        }).toString();

        console.log('\n=== QuickBooks Authorization ===');
        console.log('Open this URL in a browser to authorize:\n');
        console.log(authUri);
        console.log('\nWaiting for callback...\n');

        try {
          await open(authUri);
        } catch {
          // Headless environment — user will open the URL manually
        }
      });

      server.on('error', (error) => {
        console.error('Server error:', error);
        this.isAuthenticating = false;
        reject(error);
      });
    });
  }

  private saveTokensToEnv(): void {
    const tokenPath = path.join(__dirname, '..', '..', '.env');
    const envContent = fs.existsSync(tokenPath) ? fs.readFileSync(tokenPath, 'utf-8') : '';
    const envLines = envContent.split('\n');

    const updateEnvVar = (name: string, value: string) => {
      const index = envLines.findIndex(line => line.startsWith(`${name}=`));
      if (index !== -1) {
        envLines[index] = `${name}=${value}`;
      } else {
        envLines.push(`${name}=${value}`);
      }
    };

    if (this.refreshToken) updateEnvVar('QUICKBOOKS_REFRESH_TOKEN', this.refreshToken);
    if (this.realmId) updateEnvVar('QUICKBOOKS_REALM_ID', this.realmId);

    const tmpPath = `${tokenPath}.tmp.${process.pid}`;
    try {
      fs.writeFileSync(tmpPath, envLines.join('\n'), { mode: 0o600 });
      fs.renameSync(tmpPath, tokenPath);
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
      throw err;
    }
  }

  async refreshAccessToken() {
    if (!this.refreshToken) {
      await this.startOAuthFlow();
      if (!this.refreshToken) {
        throw new Error('Failed to obtain refresh token from OAuth flow');
      }
    }

    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = (async () => {
      try {
        const authResponse = await this.oauthClient.refreshUsingToken(this.refreshToken!);

        const token = authResponse.token as unknown as {
          access_token: string;
          expires_in?: number;
          refresh_token?: string;
          x_refresh_token_expires_in?: number;
        };

        this.accessToken = token.access_token;

        const expiresIn = token.expires_in || 3600;
        this.accessTokenExpiry = new Date(Date.now() + expiresIn * 1000);

        // Intuit rotates the refresh token (~every 24h). Persist it per-company.
        const newRefreshToken = token.refresh_token;
        if (newRefreshToken && newRefreshToken !== this.refreshToken) {
          this.refreshToken = newRefreshToken;
          try {
            if (this.realmId) companyStore.setRefreshToken(this.realmId, this.refreshToken);
            console.error('[qbo-client] Refresh token rotated and persisted to company store');
          } catch (persistErr) {
            console.error('[qbo-client] Failed to persist rotated refresh token:', persistErr);
          }
        }

        const refreshExpiresIn = token.x_refresh_token_expires_in;
        if (typeof refreshExpiresIn === 'number' && refreshExpiresIn < 14 * 24 * 3600) {
          const days = Math.round(refreshExpiresIn / 86400);
          console.error(`[qbo-client] WARNING: refresh token for realm ${this.realmId} expires in ~${days} day(s). Re-authorize before it expires.`);
        }

        return {
          access_token: this.accessToken!,
          expires_in: expiresIn,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to refresh Quickbooks token: ${message}`);
      } finally {
        this.refreshInFlight = undefined;
      }
    })();

    return this.refreshInFlight;
  }

  async authenticate(): Promise<QuickBooks> {
    if (this.authInFlight) {
      return this.authInFlight;
    }

    this.authInFlight = (async () => {
      try {
        if (!this.refreshToken || !this.realmId) {
          await this.startOAuthFlow();
          if (!this.refreshToken || !this.realmId) {
            throw new Error('Failed to obtain required tokens from OAuth flow');
          }
        }

        if (this.isTokenExpiredOrExpiringSoon()) {
          await this.refreshAccessToken();
        }

        this.quickbooksInstance = new QuickBooks(
          this.clientId,
          this.clientSecret,
          this.accessToken!,
          false,
          this.realmId!,
          this.environment === 'sandbox',
          false,
          null,
          '2.0',
          this.refreshToken
        );

        return this.quickbooksInstance;
      } finally {
        this.authInFlight = undefined;
      }
    })();

    return this.authInFlight;
  }

  // ── Called by every handler on every request — now company-aware ────────────
  static async getInstance(): Promise<QuickBooks> {
    const client = QuickbooksClient.forRealm(QuickbooksClient.resolveRealmId());
    if (client.isTokenExpiredOrExpiringSoon()) {
      await client.authenticate();
    }
    if (!client.quickbooksInstance) {
      await client.authenticate();
    }
    return client.quickbooksInstance!;
  }

  static async getAuthCredentials(): Promise<{ accessToken: string; realmId: string; isSandbox: boolean }> {
    const client = QuickbooksClient.forRealm(QuickbooksClient.resolveRealmId());
    if (client.isTokenExpiredOrExpiringSoon() || !client.accessToken) {
      await client.authenticate();
    }
    if (!client.accessToken || !client.realmId) {
      throw new Error('Quickbooks not authenticated');
    }
    return {
      accessToken: client.accessToken,
      realmId: client.realmId,
      isSandbox: client.environment === 'sandbox',
    };
  }

  getQuickbooks() {
    if (!this.quickbooksInstance) {
      throw new Error('Quickbooks not authenticated. Call authenticate() first');
    }
    return this.quickbooksInstance;
  }
}

// Backward-compat default instance for the local `npm run auth` flow
// (src/auth-server.ts). In multi-company HTTP mode this instance is unused —
// onboarding goes through the company store instead.
export const quickbooksClient = new QuickbooksClient({
  clientId: client_id,
  clientSecret: client_secret,
  refreshToken: default_refresh_token,
  realmId: default_realm,
  environment: default_environment,
  redirectUri: redirect_uri,
});
