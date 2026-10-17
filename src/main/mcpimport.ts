/**
 * Per-folder import from VS Code's `.vscode/mcp.json` (spec 020 FR-020..FR-031). Reads the file, never writes it; nothing here touches
 * `~/.copilot/mcp-config.json`. No Electron import (testable). Imported servers are created as extras of ONE folder key through
 * `McpStore.upsert`, so they are switched off and untrusted: the first switch-on shows the trust dialog.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { MAX_SERVERS, trustHash } from '../shared/mcp';
import type { McpServerView } from '../shared/mcp';
import { NAME_RE } from '../shared/mcp';
import { candidateInput, parseVSCodeMcp } from '../shared/mcpimport';
import type { VSCodeCandidate } from '../shared/mcpimport';
import type { McpImportFile, McpImportItem, McpImportPreview, McpImportResult } from '../shared/api';
import type { McpStore } from './mcpstore';

export const VSCODE_FILE_LABEL = '.vscode/mcp.json';
const MAX_BYTES = 1024 * 1024;
export const MAX_IMPORT_FOLDERS = 8;
const lc = (s: string): string => s.toLowerCase();

type Read = { state: 'ok'; text: string } | { state: 'missing' } | { state: 'error'; message: string };

/** Reads `<dir>/.vscode/mcp.json`: missing, too big and unreadable are told apart; the content is never executed. */
export function readVSCodeFile(dir: string): Read {
  const file = path.join(dir, '.vscode', 'mcp.json');
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return { state: 'error', message: `${VSCODE_FILE_LABEL} is not a file.` };
    if (st.size > MAX_BYTES) return { state: 'error', message: `${VSCODE_FILE_LABEL} is larger than 1 MiB: not read.` };
    return { state: 'ok', text: fs.readFileSync(file, 'utf8') };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'missing' };
    return { state: 'error', message: `${VSCODE_FILE_LABEL} could not be read.` };
  }
}

interface Entry {
  item: McpImportItem;
  cand: VSCodeCandidate;
}

interface Scan {
  preview: McpImportPreview;
  entries: Entry[];
}

/** A free name: the cleaned name, else `<name>-vscode`, `<name>-vscode-2`, ... (within the 48 character rule). */
function freeName(base: string, taken: Set<string>): string {
  if (!taken.has(lc(base))) return base;
  for (let n = 1; n < 1000; n++) {
    const suffix = n === 1 ? '-vscode' : `-vscode-${n}`;
    const cand = base.slice(0, 48 - suffix.length).replace(/[-_.]+$/, '') + suffix;
    if (NAME_RE.test(cand) && !taken.has(lc(cand))) return cand;
  }
  return base;
}

/**
 * Read and map the files of `dirs` (the folders of one key). `existing` = this folder's current extras, `reserved` = Copilot CLI list
 * and built-in names. Secret values stay in `entries` (main only); the preview has keys and flags.
 */
function scan(dirs: string[], existing: McpServerView[], reserved: Iterable<string>): Scan {
  const files: McpImportFile[] = [];
  const entries: Entry[] = [];
  const hash = createHash('sha256');
  const taken = new Set<string>([...reserved].map(lc));
  const sameDef = new Map<string, McpServerView>();
  const existingNames = new Set(existing.map((v) => lc(v.name)));
  for (const v of existing) sameDef.set(trustHash(v), v);
  for (const n of existingNames) taken.add(n);
  const multi = dirs.length > 1;
  let skipped = 0;
  dirs.slice(0, MAX_IMPORT_FOLDERS).forEach((dir, idx) => {
    const from = path.basename(dir) || dir;
    const r = readVSCodeFile(dir);
    hash.update(`${idx}\0${r.state}\0${r.state === 'ok' ? r.text : ''}\0`);
    if (r.state === 'missing') return void files.push({ from, state: 'missing', skipped: 0, inputs: [] });
    if (r.state === 'error') return void files.push({ from, state: 'error', message: r.message, skipped: 0, inputs: [] });
    const p = parseVSCodeMcp(r.text, { workspaceFolder: dir });
    if (!p.ok) return void files.push({ from, state: 'error', message: p.error, skipped: 0, inputs: [] });
    files.push({ from, state: 'ok', skipped: p.skipped, inputs: p.inputs });
    skipped += p.skipped;
    for (const cand of p.candidates) {
      const same = sameDef.get(trustHash(candidateInput(cand)));
      const notes = cand.notes.slice();
      let name = cand.name;
      const already = !!same;
      if (!already && taken.has(lc(name))) {
        const fresh = freeName(name, taken);
        notes.push(`The name "${name}" is already taken here (Copilot CLI list or another extra); it will be imported as "${fresh}".`);
        name = fresh;
      }
      if (already) name = same.name;
      else taken.add(lc(name));
      const rows = (l: VSCodeCandidate['env']) => l.map((x) => ({ key: x.key, hasValue: x.value !== undefined }));
      const item: McpImportItem = {
        id: `${idx}:${cand.originalName}`,
        name,
        originalName: cand.originalName,
        from: multi ? from : undefined,
        transport: cand.transport,
        command: cand.command,
        args: cand.args,
        workingDirectory: cand.workingDirectory,
        url: cand.url,
        env: rows(cand.env),
        headers: rows(cand.headers),
        notes,
        blocked: cand.blocked,
        alreadyAdded: already || undefined,
      };
      entries.push({ item, cand: { ...cand, name } });
    }
  });
  const anyOk = files.some((f) => f.state === 'ok');
  const errs = files.filter((f) => f.state === 'error');
  const preview: McpImportPreview = {
    ok: anyOk,
    label: VSCODE_FILE_LABEL,
    files,
    items: entries.map((e) => e.item),
    digest: hash.digest('hex'),
    skipped,
  };
  if (!anyOk) preview.error = errs.length ? (errs[0].message ?? 'The file could not be read.') : `No ${VSCODE_FILE_LABEL} in this folder.`;
  return { preview, entries };
}

/** The preview for the renderer: keys, flags and notes, never a secret value. */
export function previewFolderImport(dirs: string[], existing: McpServerView[], reserved: Iterable<string>): McpImportPreview {
  return scan(dirs, existing, reserved).preview;
}

/**
 * Create the ticked entries as extras of `key` (off, not trusted). The files are read again and must still match the previewed digest.
 * `reserved` = Copilot CLI list and built-in names.
 */
export function applyFolderImport(store: McpStore, key: string, dirs: string[], ids: string[], digest: string, reserved: Iterable<string>): McpImportResult {
  const none = (error: string): McpImportResult => ({ ok: false, error, imported: [], failed: [] });
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_SERVERS || !ids.every((i) => typeof i === 'string' && i.length <= 200)) return none('Nothing selected.');
  const res = [...reserved];
  const { preview, entries } = scan(dirs, store.list(key), res);
  if (!preview.ok) return none(preview.error ?? 'The file could not be read.');
  if (preview.digest !== digest) return none('The file changed since the preview. Open the import again.');
  const imported: string[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const id of new Set(ids)) {
    const e = entries.find((x) => x.item.id === id);
    if (!e) {
      failed.push({ name: id.replace(/^\d+:/, '').slice(0, 48), error: 'Not found in the file any more.' });
      continue;
    }
    if (e.item.blocked) {
      failed.push({ name: e.item.name, error: e.item.blocked });
      continue;
    }
    if (e.item.alreadyAdded) {
      failed.push({ name: e.item.name, error: 'Already added.' });
      continue;
    }
    const r = store.upsert(key, candidateInput(e.cand), undefined, res);
    if (r.ok) imported.push(e.item.name);
    else failed.push({ name: e.item.name, error: r.error ?? 'Not saved.' });
  }
  return { ok: imported.length > 0 || failed.length === 0, imported, failed };
}
