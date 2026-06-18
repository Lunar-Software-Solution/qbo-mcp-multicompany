import { companyStore } from "../clients/company-store.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

/**
 * List the companies this server can act on, from the company store.
 *
 * Company-agnostic — it does NOT use QuickbooksClient.getInstance() (no realm
 * needed) and ignores any injected `company` argument. Exposes only non-secret
 * fields so a connected MCP client can discover realm IDs to pass as `company`.
 */
export async function listQuickbooksCompanies(): Promise<ToolResponse<any>> {
  try {
    const companies = companyStore.list().map((c) => ({
      realmId: c.realmId,
      displayName: c.displayName,
      environment: c.environment,
      connectedAt: c.connectedAt,
    }));
    return { result: companies, isError: false, error: null };
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
