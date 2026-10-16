import * as fs from 'fs';
import * as path from 'path';

/** Strip // and /* *\/ comments and trailing commas (VS Code files are JSONC), respecting strings. */
function parseJsonc(text: string): unknown {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Folders listed in a .code-workspace file, as absolute paths (relative ones resolve against the file). */
export function readCodeWorkspaceFolders(file: string): string[] {
  const doc = parseJsonc(fs.readFileSync(file, 'utf8')) as { folders?: { path?: string }[] };
  const base = path.dirname(path.resolve(file));
  return (doc.folders ?? [])
    .map((f) => f.path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map((p) => path.resolve(base, p));
}

/**
 * Resolve a folder or .code-workspace file to the session cwd:
 * a folder is used as is; for a workspace file the first listed folder is used.
 */
export function resolveWorkspaceCwd(workspace: string): { cwd: string; folders: string[]; workspaceFile?: string } {
  const abs = path.resolve(workspace);
  const st = fs.statSync(abs);
  if (st.isDirectory()) return { cwd: abs, folders: [abs] };
  if (abs.endsWith('.code-workspace')) {
    const folders = readCodeWorkspaceFolders(abs);
    if (!folders.length) throw new Error(`No folders in workspace file: ${abs}`);
    return { cwd: folders[0], folders, workspaceFile: abs };
  }
  throw new Error(`Not a folder or .code-workspace file: ${abs}`);
}
