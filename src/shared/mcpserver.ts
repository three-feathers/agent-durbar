/**
 * Durbar MCP server: neutral constants (spec 041). No Electron, no vendor types, no I/O.
 * Shared by the main process, the bridge and the tests.
 */

/** Reserved server name (FR-032): the MCP extras store refuses it, the copy-paste configs use it. */
export const MCP_SERVER_NAME = 'agent-durbar';

/** Argument that makes the Durbar executable run as the stdio bridge (plan: Bridge entry). */
export const MCP_BRIDGE_FLAG = '--durbar-mcp-bridge';

/** Marker set only in each agent runtime's environment (FR-034, FR-057); the bridge refuses when it is present. */
export const MCP_MARKER_ENV = 'AGENT_DURBAR_RUNTIME';

/** Limits (FR-040, FR-061). */
export const MCP_LIMITS = {
  /** One JSON-RPC message, in bytes (64 KB). */
  maxMessageBytes: 64 * 1024,
  /** Calls per second, per connection. */
  maxCallsPerSecond: 10,
  /** Authenticated connections at once. */
  maxConnections: 3,
  /** Change requests waiting besides the one on screen. */
  maxQueueWaiting: 5,
  /** Handshake must finish within this time (FR-061), in ms. */
  handshakeTimeoutMs: 2000,
  /** Request statuses are kept this long (FR-024), in ms. */
  statusRetentionMs: 15 * 60 * 1000,
  /** String caps the window already uses. */
  maxNameLength: 64,
  maxModelLength: 100,
  maxFloorIdLength: 20,
  maxPathLength: 4096,
} as const;

/** Longest Unix socket path Durbar will bind, in bytes (sun_path is 104 on macOS, 108 on Linux; 103 leaves room for the NUL). */
export const UNIX_SOCKET_MAX_BYTES = 103;

/** Request statuses (FR-024). `refused` is also the answer to Allow all and to trusting an extra (FR-050). */
export const MCP_STATUSES = ['pending', 'applied', 'denied', 'expired', 'stale', 'failed', 'busy', 'refused'] as const;
export type McpStatus = (typeof MCP_STATUSES)[number];

/** Text of the `refused` answer to a switch to Allow all (FR-050, FR-060). */
export const MCP_REFUSE_ALLOW_ALL = "Allow all can only be turned on in Durbar's own window.";

/** File and folder names (plan: Transport, bridge and key file). */
export const MCP_DIR_NAME = 'mcp';
export const MCP_KEY_FILE_NAME = 'connection.json';
export const MCP_SOCKET_FILE_NAME = 'mcp.sock';
