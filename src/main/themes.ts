/**
 * User theme packs (spec 040): folders under `userData/themes/<id>/manifest.json`.
 * Import = copy a picked folder in (validated); export = copy a pack's folder out.
 * No network, no zip, no symlinks. The renderer re-validates everything again (theme.js).
 */
import * as fs from 'fs';
import * as path from 'path';
import { checkUserManifest, USER_THEME_LIMITS } from '../shared/themes';

export interface UserThemeEntry {
  id: string;
  name: string;
  ok: boolean;
  error?: string;
  folder?: string;
  manifest?: Record<string, unknown>;
}

const SAFE_FILE = /^manifest\.json$/; // for now only the manifest is honoured; other files are copied as-is

export class UserThemeStore {
  constructor(private readonly root: string) {}

  private dir(id: string): string {
    return path.join(this.root, id);
  }

  /** Scan the folder. Valid packs and invalid folders (with the reason) are both returned. */
  list(): UserThemeEntry[] {
    const out: UserThemeEntry[] = [];
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return out;
    }
    for (const name of names) {
      const dir = this.dir(name);
      const mf = path.join(dir, 'manifest.json');
      let text = '';
      try {
        const st = fs.lstatSync(dir);
        if (!st.isDirectory() || st.isSymbolicLink()) {
          out.push({ id: name, name, ok: false, error: 'not a plain folder' });
          continue;
        }
        text = fs.readFileSync(mf, 'utf8');
      } catch {
        out.push({ id: name, name, ok: false, error: 'no readable manifest.json' });
        continue;
      }
      const v = checkUserManifest(text);
      if (!v.ok || !v.id) {
        out.push({ id: name, name, ok: false, error: v.error || 'invalid manifest' });
        continue;
      }
      if (v.id !== name) {
        out.push({ id: name, name, ok: false, error: 'folder name must equal the manifest id (' + v.id + ')' });
        continue;
      }
      out.push({ id: v.id, name: v.name || v.id, ok: true, folder: dir, manifest: v.manifest });
    }
    return out;
  }

  /** One validated manifest by id, or null. */
  get(id: string): Record<string, unknown> | null {
    const e = this.list().find((x) => x.id === id && x.ok);
    return e && e.manifest ? e.manifest : null;
  }

  /** Copy a picked folder into the store. The folder name may differ from the id; it lands under the manifest id. */
  importFolder(from: string, isBuiltIn: (id: string) => boolean): { ok: boolean; id?: string; name?: string; error?: string } {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(from);
    } catch {
      return { ok: false, error: 'that folder does not exist' };
    }
    if (!st.isDirectory() || st.isSymbolicLink()) return { ok: false, error: 'pick a plain folder with a manifest.json' };
    let text = '';
    try {
      text = fs.readFileSync(path.join(from, 'manifest.json'), 'utf8');
    } catch {
      return { ok: false, error: 'no manifest.json in that folder' };
    }
    const v = checkUserManifest(text);
    if (!v.ok || !v.id) return { ok: false, error: v.error || 'invalid manifest' };
    if (isBuiltIn(v.id)) return { ok: false, error: '"' + v.id + '" is a built-in theme id' };
    const files = fs.readdirSync(from, { withFileTypes: true });
    if (files.filter((f) => f.isFile()).length > USER_THEME_LIMITS.maxFiles) return { ok: false, error: 'a pack may carry at most ' + USER_THEME_LIMITS.maxFiles + ' files' };
    for (const f of files) {
      if (!f.isFile()) continue;
      const s = fs.lstatSync(path.join(from, f.name));
      if (s.isSymbolicLink()) return { ok: false, error: 'no links inside a pack, please' };
      if (s.size > USER_THEME_LIMITS.maxFileBytes) return { ok: false, error: f.name + ' is over 64 KB' };
    }
    const dest = this.dir(v.id);
    if (fs.existsSync(dest)) return { ok: false, error: 'a theme with this id is already installed' };
    fs.mkdirSync(this.root, { recursive: true });
    const tmp = this.dir('.' + v.id + '.tmp-' + process.pid);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    for (const f of files) {
      if (!f.isFile()) continue;
      const src = path.join(from, f.name);
      if (fs.lstatSync(src).isSymbolicLink()) continue;
      fs.copyFileSync(src, path.join(tmp, f.name));
    }
    fs.renameSync(tmp, dest);
    return { ok: true, id: v.id, name: v.name };
  }

  /** Copy an installed pack's folder to a picked directory. */
  exportFolder(id: string, to: string): { ok: boolean; to?: string; error?: string } {
    const e = this.list().find((x) => x.id === id && x.ok);
    if (!e || !e.folder) return { ok: false, error: 'no user theme with this id' };
    const dest = path.join(to, id);
    if (fs.existsSync(dest)) return { ok: false, error: 'a "' + id + '" folder already exists there' };
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(e.folder, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      const src = path.join(e.folder, f.name);
      if (fs.lstatSync(src).isSymbolicLink()) continue;
      fs.copyFileSync(src, path.join(dest, f.name));
    }
    return { ok: true, to: dest };
  }
}

export { SAFE_FILE };
