/**
 * Process entry (package.json "main"). The MCP bridge (spec 041 T018) is the same executable started with
 * `--durbar-mcp-bridge`: that check is the FIRST thing that runs, before `main.ts` is loaded, because `main.ts`
 * registers ipc handlers and builds stores at module level. In bridge mode `main.ts` is never required, so no
 * handler, store, window or single-instance lock exists in the process.
 */
import { app } from 'electron';
import { MCP_BRIDGE_FLAG } from '../shared/mcpserver';

if (process.argv.includes(MCP_BRIDGE_FLAG)) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  (require('./mcp/bridge') as typeof import('./mcp/bridge')).runMcpBridge(app, process.env);
} else {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('./main');
}
