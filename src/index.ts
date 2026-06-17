#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createQuickbooksMcpServer } from "./server/build-server.js";

// HTTP (multi-company) when MCP_TRANSPORT=http or PORT is set; otherwise stdio
// (single-company, backward compatible with the original local usage).
const useHttp = process.env.MCP_TRANSPORT === "http" || !!process.env.PORT;

async function startStdio(): Promise<void> {
  const server = createQuickbooksMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttp(): Promise<void> {
  // Lazy-import so stdio mode never loads Express.
  const { createHttpApp } = await import("./http/app.js");
  const app = createHttpApp();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.error(`[qbo-mcp] HTTP server listening on :${port} (multi-company)`);
  });
}

(useHttp ? startHttp() : startStdio()).catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
