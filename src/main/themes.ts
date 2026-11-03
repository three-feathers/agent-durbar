/**
 * User theme packs (spec 040): folders under `userData/themes/<id>/manifest.json`.
 * Export = copy a pack's folder out; remove = delete it (spec 040 FR-032; Import and the AI maker were retired, FR-031).
 * No network, no zip, no symlinks. The renderer re-validates everything again (theme.js).
 */
import * as fs from 'fs';
import * as path from 'path';
import { checkUserManifest } from '../shared/themes';

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
      names = fs.readdirSync(this.root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name); // dot folders are unfinished imports
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

  /**
   * Spec 040 FR-032: delete one saved theme's folder. The id must be a plain folder `list()` shows (never a link, never a path); links
   * inside it are removed as links and never followed, so nothing outside the store is touched.
   */
  remove(id: string): { ok: boolean; id?: string; error?: string } {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id) || !this.list().some((x) => x.id === id)) return { ok: false, error: 'no saved theme with this id' };
    const dir = this.dir(id);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      return { ok: false, error: 'the theme could not be removed' };
    }
    return { ok: true, id };
  }
}

export { SAFE_FILE };
