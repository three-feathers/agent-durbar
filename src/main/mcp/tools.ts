/**
 * Durbar MCP tool registry and `tools/list` / `tools/call` dispatch, spec 041 T013
 * [FR-004, FR-010, FR-020, FR-028, FR-064, US1-2]. Static: the names, descriptions and schemas need
 * no running window (the bridge can list them offline). Handlers are injected: T016 supplies the read
 * tools, T030+ the change tools. Pure, no I/O. No tool for FR-028 (sessions, prompts, permissions,
 * limits) exists here, in any build.
 */
import { McpError, MethodHandler } from './protocol';
import { ERR_INTERNAL, ERR_INVALID_PARAMS } from './jsonrpc';

/**
 * Build flag (FR-064): change tools are neither listed nor dispatched until the confirmation dialog
 * exists. T038 turns this on. Tests flip it through the `changeToolsEnabled` option, never by editing it.
 */
export const CHANGE_TOOLS_ENABLED = false;

/** The small JSON Schema subset the registry uses (and validates). */
export interface JsonSchema {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  enum?: readonly (string | number)[];
  maxLength?: number;
  minimum?: number;
  /** Several types, e.g. a number or null (a cap that can be removed). */
  anyOf?: readonly JsonSchema[];
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Read tools answer at once; change tools queue a confirmation in Durbar's window. */
  kind: 'read' | 'change';
}

const CONFIRM = ' Every change needs your confirmation in Durbar\'s own window before it is applied.';
const NO_ARGS: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };
const TARGET = { type: 'string', maxLength: 64, description: 'Agent id' } as const;

/** Frozen all the way down: nothing can add a change tool to a list, or loosen a schema, at runtime. */
function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

export const READ_TOOLS: readonly ToolDef[] = deepFreeze<ToolDef[]>([
  { kind: 'read', name: 'durbar_list_folders', description: 'List the folders in Durbar: key, name, floor, hidden, door, adapter kind, mode, cap and number of agents.', inputSchema: NO_ARGS },
  { kind: 'read', name: 'durbar_list_agents', description: 'List the agents: id, name, folder, floor, adapter kind, mode, model, cap, state (the office word and sub-label) and whether it is lazy.', inputSchema: NO_ARGS },
  { kind: 'read', name: 'durbar_list_floors', description: 'List the floors of the office and which are on.', inputSchema: NO_ARGS },
  { kind: 'read', name: 'durbar_usage_totals', description: 'AI credit usage totals for the office and per folder: saved baseline plus this run, and since when.', inputSchema: NO_ARGS },
  { kind: 'read', name: 'durbar_settings', description: 'Durbar settings: default cap, serious mode, place map and custom places.', inputSchema: NO_ARGS },
  { kind: 'read', name: 'durbar_mcp_state', description: 'MCP servers Durbar agents use: Copilot CLI list and per-folder extras (secret values are never shown, only key names).', inputSchema: NO_ARGS },
  {
    kind: 'read',
    name: 'durbar_request_status',
    description: 'Status of a change request made earlier through this server (pending, applied, denied, expired, stale, failed, busy or refused).',
    inputSchema: { type: 'object', properties: { requestId: { type: 'string', maxLength: 64, description: 'Id returned by a change tool' } }, required: ['requestId'], additionalProperties: false },
  },
]);

/** Defined now so the flag has something to switch; listed and dispatched only when the flag is on (T038). */
export const CHANGE_TOOLS: readonly ToolDef[] = deepFreeze<ToolDef[]>([
  {
    kind: 'change',
    name: 'durbar_set_mode',
    description: 'Ask to switch an agent or folder between Read-only and Ask first. Allow all is refused here and can only be turned on in Durbar\'s own window.' + CONFIRM,
    inputSchema: { type: 'object', properties: { target: TARGET, mode: { type: 'string', enum: ['read-only', 'ask'] } }, required: ['target', 'mode'], additionalProperties: false },
  },
  {
    kind: 'change',
    name: 'durbar_set_cap',
    description: 'Ask to set or remove an agent\'s AI credit cap.' + CONFIRM,
    inputSchema: { type: 'object', properties: { target: TARGET, cap: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] } }, required: ['target', 'cap'], additionalProperties: false },
  },
  {
    kind: 'change',
    name: 'durbar_set_default_cap',
    description: 'Ask to set the default AI credit cap for new agents.' + CONFIRM,
    inputSchema: { type: 'object', properties: { cap: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] } }, required: ['cap'], additionalProperties: false },
  },
  {
    kind: 'change',
    name: 'durbar_add_folder',
    description: 'Ask to add a folder or workspace file. It lands on the last floor.' + CONFIRM,
    inputSchema: { type: 'object', properties: { path: { type: 'string', maxLength: 4096 }, mode: { type: 'string', enum: ['read-only', 'ask'] }, cap: { type: 'number', minimum: 0 } }, required: ['path'], additionalProperties: false },
  },
  {
    kind: 'change',
    name: 'durbar_remove_folder',
    description: 'Ask to remove a folder from Durbar.' + CONFIRM,
    inputSchema: { type: 'object', properties: { folder: { type: 'string', maxLength: 4096 } }, required: ['folder'], additionalProperties: false },
  },
  {
    kind: 'change',
    name: 'durbar_mcp_extra_add',
    description: 'Ask to add a per-folder MCP extra. It is saved off and untrusted; trusting it is done only in Durbar\'s own window.' + CONFIRM,
    inputSchema: { type: 'object', properties: { folder: { type: 'string', maxLength: 4096 }, name: { type: 'string', maxLength: 64 }, command: { type: 'string', maxLength: 4096 }, url: { type: 'string', maxLength: 4096 } }, required: ['folder', 'name'], additionalProperties: false },
  },
  {
    kind: 'change',
    name: 'durbar_mcp_extra_edit',
    description: 'Ask to edit a per-folder MCP extra. It is saved off and untrusted again.' + CONFIRM,
    inputSchema: { type: 'object', properties: { folder: { type: 'string', maxLength: 4096 }, name: { type: 'string', maxLength: 64 }, command: { type: 'string', maxLength: 4096 }, url: { type: 'string', maxLength: 4096 } }, required: ['folder', 'name'], additionalProperties: false },
  },
  {
    kind: 'change',
    name: 'durbar_mcp_extra_remove',
    description: 'Ask to remove a per-folder MCP extra.' + CONFIRM,
    inputSchema: { type: 'object', properties: { folder: { type: 'string', maxLength: 4096 }, name: { type: 'string', maxLength: 64 } }, required: ['folder', 'name'], additionalProperties: false },
  },
  {
    kind: 'change',
    name: 'durbar_mcp_extra_set_enabled',
    description: 'Ask to turn a per-folder MCP extra on or off. Only an extra you already trusted in Durbar\'s window can be turned on.' + CONFIRM,
    inputSchema: { type: 'object', properties: { folder: { type: 'string', maxLength: 4096 }, name: { type: 'string', maxLength: 64 }, enabled: { type: 'boolean' } }, required: ['folder', 'name', 'enabled'], additionalProperties: false },
  },
]);

/** What a tool returns: MCP `tools/call` result content. */
export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}
export type ToolHandler = (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;
export type ToolHandlers = Record<string, ToolHandler>;

/** A schema check; returns false for anything the schema does not allow. No messages: nothing leaks. */
export function matches(schema: JsonSchema, v: unknown): boolean {
  if (schema.anyOf) return schema.anyOf.some((s) => matches(s, v));
  if (schema.enum && !schema.enum.includes(v as string | number)) return false;
  switch (schema.type) {
    case 'string':
      return typeof v === 'string' && (schema.maxLength === undefined || v.length <= schema.maxLength);
    case 'number':
    case 'integer':
      return typeof v === 'number' && Number.isFinite(v) && (schema.type !== 'integer' || Number.isInteger(v)) && (schema.minimum === undefined || v >= schema.minimum);
    case 'boolean':
      return typeof v === 'boolean';
    case 'null':
      return v === null;
    case 'object': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
      const o = v as Record<string, unknown>;
      const props = schema.properties ?? {};
      for (const r of schema.required ?? []) if (!Object.prototype.hasOwnProperty.call(o, r)) return false;
      for (const k of Object.keys(o)) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) {
          if (schema.additionalProperties === false) return false;
          continue;
        }
        if (!matches(props[k], o[k])) return false;
      }
      return true;
    }
    default:
      return false; // a node with no known type (and no anyOf) accepts nothing: fail closed
  }
}

export interface ToolRegistryOptions {
  handlers: ToolHandlers;
  /** Test seam; defaults to the build flag. */
  changeToolsEnabled?: boolean;
}

export interface ToolRegistry {
  /** Tools a client may see and call right now. */
  list(): ToolDef[];
  /** `methods` for `McpSession` (T012). */
  methods(): Record<string, MethodHandler>;
}

export function createToolRegistry(opts: ToolRegistryOptions): ToolRegistry {
  const enabled = opts.changeToolsEnabled ?? CHANGE_TOOLS_ENABLED;
  const defs = (): ToolDef[] => (enabled ? [...READ_TOOLS, ...CHANGE_TOOLS] : [...READ_TOOLS]);
  const byName = (name: string): ToolDef | undefined => defs().find((t) => t.name === name);
  return {
    list: defs,
    methods: () => ({
      'tools/list': () => ({ tools: defs().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }),
      'tools/call': (params: unknown) => {
        const p = typeof params === 'object' && params !== null && !Array.isArray(params) ? (params as Record<string, unknown>) : null;
        if (!p || typeof p.name !== 'string') throw new McpError(ERR_INVALID_PARAMS, 'Invalid params');
        const def = byName(p.name);
        // A change tool with the flag off is "unknown", exactly like a name that never existed (MCP: -32602).
        if (!def) throw new McpError(ERR_INVALID_PARAMS, 'Unknown tool');
        const handler = Object.prototype.hasOwnProperty.call(opts.handlers, def.name) ? opts.handlers[def.name] : undefined;
        if (!handler) throw new McpError(ERR_INTERNAL, 'Internal error'); // listed but not wired: a bug, not the caller's
        const args = p.arguments === undefined ? {} : p.arguments;
        if (!matches(def.inputSchema, args)) throw new McpError(ERR_INVALID_PARAMS, 'Invalid params');
        return handler(args as Record<string, unknown>);
      },
    }),
  };
}

