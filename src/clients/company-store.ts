import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Persisted per-company record. One Intuit app authorizes many companies; each
 * authorization yields a distinct realmId + refresh token. Refresh tokens
 * rotate (~every 24h) and must survive restarts, so they live here rather than
 * in .env. In Docker this file sits on a mounted volume.
 */
export interface CompanyRecord {
  realmId: string;
  refreshToken: string;
  environment: string; // "sandbox" | "production"
  displayName?: string;
  connectedAt?: string;
  updatedAt?: string;
}

// Default to <repo>/data; override with QBO_DATA_DIR (set to /app/data in Docker).
const DATA_DIR = process.env.QBO_DATA_DIR || path.join(__dirname, "..", "..", "data");
const STORE_PATH = path.join(DATA_DIR, "companies.json");

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function readAll(): Record<string, CompanyRecord> {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8")) as Record<string, CompanyRecord>;
  } catch {
    // Corrupt/unreadable store should not crash the server.
    return {};
  }
}

function writeAll(records: Record<string, CompanyRecord>): void {
  ensureDir();
  // Atomic write: temp file then rename (same pattern the client used for .env).
  const tmp = `${STORE_PATH}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE_PATH);
}

export const companyStore = {
  get(realmId: string): CompanyRecord | undefined {
    return readAll()[realmId];
  },

  list(): CompanyRecord[] {
    return Object.values(readAll());
  },

  /** Create or replace a company record (used by the OAuth onboarding flow). */
  upsert(rec: Omit<CompanyRecord, "connectedAt" | "updatedAt">): CompanyRecord {
    const all = readAll();
    const now = new Date().toISOString();
    const existing = all[rec.realmId];
    const merged: CompanyRecord = {
      ...rec,
      connectedAt: existing?.connectedAt ?? now,
      updatedAt: now,
    };
    all[rec.realmId] = merged;
    writeAll(all);
    return merged;
  },

  /** Persist a rotated refresh token without disturbing other fields. */
  setRefreshToken(realmId: string, refreshToken: string): void {
    const all = readAll();
    const existing = all[realmId];
    if (!existing) return; // realm not tracked here (e.g. legacy env-seeded default)
    existing.refreshToken = refreshToken;
    existing.updatedAt = new Date().toISOString();
    writeAll(all);
  },
};
