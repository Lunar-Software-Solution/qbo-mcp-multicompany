import { listQuickbooksCompanies } from "../handlers/list-companies.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "list_companies";
const toolDescription =
  "List the QuickBooks companies this server can act on. Returns each company's realmId, name, and environment. Use a returned realmId as the `company` argument on other tools when this connection serves multiple companies.";

const toolSchema = z.object({});

const toolHandler = async () => {
  const response = await listQuickbooksCompanies();
  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error listing companies: ${response.error}` }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(response.result) }] };
};

export const ListCompaniesTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
