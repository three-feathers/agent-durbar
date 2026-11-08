/**
 * The activity log's mask (spec 012 FR-175, issue #1295). `logActivity` used to run the action through `redact` alone; the chat and the permission cards mask it through the window's own
 * `DurbarLiveAct.permText` (control codes and escape strings read away first, a command by the command mask, a tool name word by word, a token an escape splits hides the whole text).
 * This calls that same function, loaded the way `rendererScript` loads a window script, fed the shared masks: one rule set, no copy. Fails closed: when the script cannot be loaded, or
 * throws, the neutral word of the kind is stored, never the text.
 */
import { maskSecretCommand, maskSecretUrl, redact } from '../shared/redact';
import { rendererScript } from './convsearch';

interface PermTextResult {
  text: string;
  hidden: boolean;
  why?: string;
}
interface LiveActApi {
  permText(raw: unknown, kind: 'shell' | 'tool' | 'other', mask: { redact(t: string): string; cmd(t: string): string; url(t: string): string }): PermTextResult;
}

/** The page's `permKind` (`src/renderer/app.js`): a request kind, or a grant key's prefix, as the three words `permText` knows. */
export function activityKind(kind: unknown): 'shell' | 'tool' | 'other' {
  const k = typeof kind === 'string' ? kind : '';
  if (k === 'shell' || /^shell(-exact)?:/.test(k)) return 'shell';
  if (k === 'mcp' || k === 'custom-tool' || /^(mcp|custom-tool):/.test(k)) return 'tool';
  return 'other';
}

const FALLBACK = { shell: 'a command', tool: 'tool', other: 'request' } as const;

export function maskActivityAction(action: unknown, kind?: unknown, baseDir?: string): string {
  const k = activityKind(kind);
  try {
    const live = rendererScript<LiveActApi>('liveact.js', baseDir);
    const r = live.permText(action, k, { redact: (t) => redact(t), cmd: (t) => maskSecretCommand(t), url: (t) => maskSecretUrl(t) });
    return typeof r?.text === 'string' ? r.text : FALLBACK[k];
  } catch {
    return FALLBACK[k];
  }
}
