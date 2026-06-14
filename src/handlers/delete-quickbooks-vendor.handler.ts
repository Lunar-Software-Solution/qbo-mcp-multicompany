import { QuickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

/**
 * "Delete" a vendor in QuickBooks Online.
 *
 * QuickBooks Online does not support hard-deleting vendors, and node-quickbooks
 * exposes no `deleteVendor` method — calling it throws
 * "quickbooks.deleteVendor is not a function". The only supported way to remove
 * a vendor is to mark it inactive (`Active: false`) via `updateVendor`, mirroring
 * how the customer handler deactivates customers.
 *
 * Accepts either a vendor id or an object containing `Id` (and ideally
 * `SyncToken`). When the SyncToken is not supplied we fetch the vendor first so
 * the sparse update doesn't fail on a stale token.
 */
export async function deleteQuickbooksVendor(idOrEntity: any): Promise<ToolResponse<any>> {
  try {
    const quickbooks = await QuickbooksClient.getInstance();

    return new Promise((resolve) => {
      const applyInactive = (vendor: any) => {
        if (!vendor || !vendor.Id) {
          resolve({
            result: null,
            isError: true,
            error: formatError("Unable to retrieve vendor for inactive update"),
          });
          return;
        }

        quickbooks.updateVendor(
          { Id: vendor.Id, SyncToken: vendor.SyncToken, sparse: true, Active: false },
          (err: any, updatedVendor: any) => {
            if (err) {
              resolve({ result: null, isError: true, error: formatError(err) });
            } else {
              resolve({ result: updatedVendor, isError: false, error: null });
            }
          }
        );
      };

      const id = typeof idOrEntity === "object" && idOrEntity ? idOrEntity.Id : idOrEntity;
      const hasSyncToken =
        typeof idOrEntity === "object" && idOrEntity && idOrEntity.SyncToken !== undefined;

      if (hasSyncToken) {
        applyInactive(idOrEntity);
      } else {
        quickbooks.getVendor(id, (err: any, vendor: any) => {
          if (err) {
            resolve({ result: null, isError: true, error: formatError(err) });
          } else {
            applyInactive(vendor);
          }
        });
      }
    });
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}
