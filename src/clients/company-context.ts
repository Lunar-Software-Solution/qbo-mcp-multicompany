import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request company context.
 *
 * The HTTP transport binds each incoming MCP request to a QuickBooks company
 * (realmId) for the duration of that request. Handlers don't read this directly
 * — QuickbooksClient.getInstance() / getAuthCredentials() resolve the current
 * realm from here, so the ~90 existing handlers need no changes.
 */
export interface CompanyContext {
  realmId: string;
}

const storage = new AsyncLocalStorage<CompanyContext>();

/** Run `fn` with the given company bound as the current context. */
export function runWithCompany<T>(realmId: string, fn: () => T): T {
  return storage.run({ realmId }, fn);
}

/** The realmId bound to the current async context, if any. */
export function currentRealmId(): string | undefined {
  return storage.getStore()?.realmId;
}
