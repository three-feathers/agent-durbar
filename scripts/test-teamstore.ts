/**
 * Unit tests, spec 111 T006 (FR-001, FR-003, FR-021): `TeamTemplateStore` on an injected in-memory file system. No disk, no credits.
 * Non-ASCII is written as \u escapes; token-like data is built at run time.
 *
 * Mutants (2026-11-12, each applied to the COMPILED module `dist-scripts/src/main/teamstore.js` as a text replacement, written beside it
 * as a temporary file; the sections run again and the named section must fail; an anchor that no longer matches fails loudly):
 *   1 write straight to the file (no temp, no rename)        -> crashBetweenWriteAndRename
 *   2 file mode other than 0600                               -> fileMode
 *   3 bad file set aside without the toast flag               -> brokenSetAside
 *   4 the cap of 50 off by one                                -> cap
 *   5 duplicate name compared raw, without nameKey            -> duplicateNames
 *   6 put without checkTeamTemplate                           -> putInvalid
 *   7 load at level 'imported' instead of 'own'               -> importedFileLoads
 *   8..14 (first review): put takes the value's origin; no fsync; blocked check removed; format not checked; newer schemaVersion accepted; stale temps not removed.
 *   15..24 (second review, #1602): cut by code point, not grapheme; trailing joiners kept; no second read after a read error; decoder not fatal;
 *   no Windows rename retry; the retry on every platform; no fingerprint comparison; no pruning of set-aside files; folder mode 0755; isBlocked always false.
 *   25..27 (third review): prune filter loose; prune order by text; fingerprint taken after the read (since replaced by the hash mutant).
 *   27 became "hash taken after the read"; 28..31 (fourth review; 32, 33 fifth: the read before a save is not retried; the retry has no pause; 34, 35 sixth: a persistent read error still reloads; two unreadable reads compare as one hash; 36 seventh: a dangling link not seen, `existsSync` instead of `lstat`; 37, 38 eighth: any lstat error counts as absent; a blocked store sets aside without reading again): size only, not the content; the file just set aside may be pruned; prune counts folders;
 *   one huge grapheme leaves only the suffix. (A fingerprint of size and mtime was replaced by a SHA-256 of the bytes: it missed a write in the same mtime tick.)
 *   The list below has 38 entries in all (the "no nameKey" mutant of 5 has two variants).
 *   No `trimEnd` before the suffix: the validator already collapses a double space, so the name is the same (the test "no double space" shows it).
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import * as real from '../src/main/teamstore';

type Api = typeof real;
let n = 0;
const ok = (c: unknown, m: string): void => { n++; assert.ok(c, m); };
const eq = <T>(a: T, b: T, m: string): void => { n++; assert.deepStrictEqual(a, b, m); };

const F = path.join('userData', 'team-templates.json');
const ROOT = path.dirname(F);

/** An in-memory `TeamFs`: files with a mode, a bytes-read counter, a failing rename or write on demand. */
class MemFs {
  files = new Map<string, { data: Buffer; mode: number; size?: number; mt?: number }>();
  openFails = 0; dirModes: number[] = []; static tick = 0;
  failRename = false; failWrite = false; bytesRead = 0; writes: { file: string; mode: number; flag: string }[] = []; renames: [string, string][] = [];
  private fds = new Map<number, string>(); private nextFd = 3;
  set(file: string, text: string | Buffer): void { this.files.set(file, { data: Buffer.from(text), mode: 0o644, mt: ++MemFs.tick }); }
  text(file: string): string | undefined { return this.files.get(file)?.data.toString('utf8'); }
  names(): string[] { return [...this.files.keys()].sort(); }
  mkdirSync(_d: string, o: { mode: number }): void { this.dirModes.push(o.mode); }
  dirs = new Set<string>(); denied = false;
  private deny(): void { if (this.denied) throw Object.assign(new Error('no permission'), { code: 'EACCES' }); }
  lstatSync(p: string): { isFile(): boolean } {
    this.deny();
    if (this.dirs.has(p) || this.dangling.has(p)) return { isFile: () => false };
    if (!this.files.has(p)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return { isFile: () => true };
  }
  /** dangling symlinks: `lstat` sees them, `stat` and `exists` (which follow) do not, `open` with O_NOFOLLOW says ELOOP */
  dangling = new Set<string>();
  statSync(p: string): { isFile(): boolean } { if (!this.files.has(p)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return { isFile: () => true }; }
  writeFileSync(file: string, data: string, o: { mode: number; flag: string }): void {
    this.writes.push({ file, mode: o.mode, flag: o.flag });
    if (o.flag === 'wx' && this.files.has(file)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
    if (this.failWrite) { this.files.set(file, { data: Buffer.from(data.slice(0, 10)), mode: o.mode }); throw Object.assign(new Error('disk'), { code: 'ENOSPC' }); }
    const old = this.files.get(file);
    this.files.set(file, { data: Buffer.from(data), mode: old ? old.mode : o.mode, mt: ++MemFs.tick });
  }
  fsyncs: string[] = []; log: string[] = [];
  fsyncFile(file: string): void { this.fsyncs.push(file); this.log.push('fsync ' + file); }
  readdirSync(dir: string): string[] { this.deny(); return [...this.names(), ...this.dirs, ...this.dangling].filter((x) => path.dirname(x) === dir).map((x) => path.basename(x)); }
  renameSync(from: string, to: string): void {
    this.renames.push([from, to]); this.log.push('rename ' + from);
    if (this.failRename && to === F) throw Object.assign(new Error('rename'), { code: 'EPERM' });
    if (this.dangling.has(from)) { this.dangling.delete(from); this.dangling.add(to); return; }
    const f = this.files.get(from);
    if (!f) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
    this.dangling.delete(to);
    this.files.delete(from); this.files.set(to, f);
  }
  rmSync(p: string): void { this.files.delete(p); this.dirs.delete(p); this.dangling.delete(p); }
  openSync(file: string): number {
    this.deny();
    if (this.dangling.has(file)) throw Object.assign(new Error('loop'), { code: 'ELOOP' });
    if (!this.files.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    if (this.openFails > 0 && file === F) { this.openFails--; throw Object.assign(new Error('held'), { code: 'EBUSY' }); }
    const fd = this.nextFd++; this.fds.set(fd, file); return fd;
  }
  fstatSync(fd: number): { isFile(): boolean; size: number; nlink: number } {
    const f = this.files.get(this.fds.get(fd)!)!;
    return { isFile: () => true, size: f.size ?? f.data.length, nlink: 1 };
  }
  readSync(fd: number, buf: Buffer, off: number, len: number, pos: number): number {
    const f = this.files.get(this.fds.get(fd)!)!;
    const k = Math.max(0, Math.min(len, f.data.length - pos));
    f.data.copy(buf, off, pos, pos + k); this.bytesRead += k; return k;
  }
  afterRead: (() => void) | undefined;
  closeSync(fd: number): void { const f = this.fds.get(fd); this.fds.delete(fd); if (f === F && this.afterRead) { const h = this.afterRead; this.afterRead = undefined; h(); } }
}

const KEYS = { O_RDONLY: 0 };
let clock = 1_700_000_000_000; let seq = 0;
let pauses: number[] = [];
const make = (m: MemFs, api: Api, alive: (pid: number) => boolean = () => false, platform: NodeJS.Platform = 'linux'): InstanceType<Api['TeamTemplateStore']> =>
  new api.TeamTemplateStore(F, { fs: m, flags: KEYS, now: () => (clock += 1000), newId: () => 'id' + String(++seq).padStart(4, '0'), pid: 4242, alive, pause: (ms) => { pauses.push(ms); }, platform });

const member = (name = 'Architect', extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ name, role: 'Designs', app: 'copilot', permMode: 'ask', sendBrief: true, ...extra });
const tpl = (name = 'Review crew', extra: Record<string, unknown> = {}): Record<string, unknown> => ({ name, members: [member()], ...extra });
const stored = (id: string, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id, name, origin: 'own', createdAt: 1, updatedAt: 2, members: [member()], ...extra });
const doc = (...t: unknown[]): string => JSON.stringify({ format: 'agent-durbar-team-templates', schemaVersion: 1, templates: t }, null, 1);
const badNames = (m: MemFs): string[] => m.names().filter((x) => x.includes('.bad-'));

type Section = (api: Api) => void;
const sections: Record<string, Section> = {
  basics(api) {
    const m = new MemFs(); const s = make(m, api);
    eq(s.list(), [], 'empty at first'); ok(!s.takeToast(), 'no toast');
    const a = s.put(tpl()); ok(a.ok, 'put ok');
    if (!a.ok) return;
    eq(a.template.id, 'id0001', 'main gives the id'); eq(a.template.origin, 'own', 'origin own'); eq(a.template.createdAt, a.template.updatedAt, 'times set');
    const b = s.put({ ...a.template, name: 'Review crew 2' }); ok(b.ok && b.template.id === a.template.id && b.template.createdAt === a.template.createdAt && b.template.updatedAt > a.template.createdAt, 'update keeps id and createdAt');
    ok(s.put(tpl('Forged', { origin: 'imported' })).ok && s.list().find((t) => t.name === 'Forged')!.origin === 'own', 'put ignores the origin of the value on create');
    const forged = s.put({ ...a.template, origin: 'imported' }); ok(forged.ok && forged.template.origin === 'own', 'an update cannot change the origin');
    ok(!s.put({ ...tpl(), id: 'nosuchid' }).ok, 'an unknown id is refused');
    eq(make(m, api).list().length, 2, 'a second load reads it back'); eq(make(m, api).list()[0].name, 'Review crew', 'with its name');
    ok(m.text(F)!.endsWith('\n') && !m.text(F)!.includes('\r'), 'LF written');
    const e = s.putImported(tpl('Import')); ok(e.ok && e.template.origin === 'imported', 'the import path creates imported');
    ok(!s.putImported({ ...tpl('Import 2'), id: 'id0001' }).ok, 'putImported refuses an id'); ok(!s.putImported({ name: '', members: [] }).ok, 'putImported validates');
    const up = s.put({ ...(e.ok ? e.template : {}), name: 'Import edited' }); ok(up.ok && up.template.origin === 'imported', 'an update keeps imported');
    eq(s.get(a.template.id)?.name, 'Review crew', 'get'); eq(s.get('zzz'), undefined, 'get unknown');
    const copyOfList = s.list(); copyOfList[0].name = 'changed'; eq(s.list()[0].name, 'Review crew', 'list returns copies');
  },
  brokenSetAside(api) {
    for (const bad of ['{"version":1,"templates":[', 'null', '[]', '{"version":1,"templates":[]}', '{"format":"agent-durbar-team-templates","schemaVersion":2,"templates":[]}', '{"format":"agent-durbar-team-template","schemaVersion":1,"templates":[]}', '{"format":"agent-durbar-team-templates","schemaVersion":1.5,"templates":[]}', '{"format":"agent-durbar-team-templates","schemaVersion":1}']) {
      const m = new MemFs(); m.set(F, bad);
      const s = make(m, api);
      eq(s.list(), [], 'starts empty: ' + bad.slice(0, 12));
      const aside = badNames(m); eq(aside.length, 1, 'set aside once');
      ok(/team-templates\.bad-[0-9T-]+Z\.json$/.test(aside[0]), 'name team-templates.bad-<time>.json: ' + aside[0]);
      eq(m.text(aside[0]), bad, 'the bad file is kept whole'); ok(!m.files.has(F), 'the original is gone');
      ok(s.takeToast(), 'one toast flag'); ok(!s.takeToast(), 'the flag is taken once');
      const again = make(m, api); ok(!again.takeToast(), 'no toast on the next load'); eq(badNames(m).length, 1, 'not set aside again');
      ok(s.put(tpl()).ok, 'saving works after the set-aside'); eq(badNames(m).length, 1, 'still one bad file'); eq(m.text(aside[0]), bad, 'bad file untouched by the save');
    }
    // one invalid template among valid ones: the valid ones stay (and are saved), the whole old file is kept aside
    const m = new MemFs(); const text = doc(stored('aaa1', 'Good one'), { ...stored('bbb2', 'Bad one'), members: [] });
    m.set(F, text); const s = make(m, api);
    eq(s.list().map((t) => t.name), ['Good one'], 'valid template kept'); eq(badNames(m).length, 1, 'aside'); eq(m.text(badNames(m)[0]), text, 'old file whole');
    eq(make(m, api).list().map((t) => t.name), ['Good one'], 'and saved'); ok(s.takeToast(), 'toast');
    // a template without an id, a duplicate id
    const m2 = new MemFs(); m2.set(F, doc({ name: 'No id', members: [member()] }, stored('x1', 'A'), stored('x1', 'B')));
    eq(make(m2, api).list().map((t) => t.name), ['A'], 'no id and duplicate id are bad'); eq(badNames(m2).length, 1, 'aside');
    // a bad file that cannot be moved: nothing is written over it
    const m3 = new MemFs(); m3.set(F, '{broken'); let down = true;
    const orig = m3.renameSync.bind(m3); m3.renameSync = (a: string, b: string): void => { if (down && a === F) throw Object.assign(new Error('x'), { code: 'EPERM' }); orig(a, b); };
    const s3 = make(m3, api); ok(!s3.put(tpl()).ok, 'refused while the bad file is in the way'); eq(m3.text(F), '{broken', 'bad file intact'); eq(badNames(m3).length, 0, 'not moved yet');
    down = false; ok(s3.put(tpl()).ok, 'the set-aside is retried and the save then works'); eq(badNames(m3).length, 1, 'bad file moved'); eq(m3.text(badNames(m3)[0]), '{broken', 'whole'); ok(m3.text(F)!.includes('agent-durbar-team-templates'), 'new file written'); ok(s3.takeToast(), 'toast after the retry');
    // the same bad name in the same second
    const m4 = new MemFs(); m4.set(F, '{x'); const f4 = new api.TeamTemplateStore(F, { fs: m4, flags: KEYS, now: () => 5000 });
    ok(f4.takeToast(), 'first'); m4.set(F, '{y'); new api.TeamTemplateStore(F, { fs: m4, flags: KEYS, now: () => 5000 }); eq(badNames(m4).length, 2, 'two bad files, none overwritten');
  },
  fileMode(api) {
    const m = new MemFs(); const s = make(m, api); s.put(tpl()); s.put(tpl('Second'));
    ok(m.writes.length >= 2, 'wrote');
    for (const w of m.writes) { eq(w.mode, 0o600, 'mode 0600'); eq(w.flag, 'wx', 'a fresh temp file only'); }
    eq(m.files.get(F)!.mode, 0o600, 'the stored file has 0600'); ok(m.writes.every((w) => w.file !== F), 'never written in place');
    eq(m.names(), [F], 'no temp left'); ok(m.dirModes.length >= 2 && m.dirModes.every((x) => x === 0o700), 'the folder is made with mode 0700');
  },
  crashBetweenWriteAndRename(api) {
    const m = new MemFs(); const s = make(m, api); const a = s.put(tpl()); ok(a.ok, 'first save');
    const before = m.text(F); ok(before !== undefined, 'file exists');
    m.failRename = true;
    ok(!s.put(tpl('Second')).ok, 'put reports the failure'); eq(m.text(F), before, 'old file intact after a failed rename'); eq(m.names(), [F], 'temp removed');
    eq(s.list().length, 1, 'memory unchanged'); m.failRename = false;
    m.failWrite = true; ok(!s.put(tpl('Third')).ok, 'failed write'); eq(m.text(F), before, 'old file intact after a failed write'); eq(m.names(), [F], 'partial temp removed');
    ok(!s.delete(a.ok ? a.template.id : '').ok, 'failed delete'); eq(s.list().length, 1, 'still there'); m.failWrite = false;
    ok(s.put(tpl('Fourth')).ok, 'works again'); eq(make(m, api).list().length, 2, 'both on disk');
    // a leftover temp of an older run does not block the save
    m.set(`${F}.4242.tmp`, 'stale'); ok(s.put(tpl('Fifth')).ok, 'stale temp replaced'); eq(m.names(), [F], 'and gone');
  },
  fsyncBeforeRename(api) {
    const m = new MemFs(); const s = make(m, api); s.put(tpl());
    const i = m.log.findIndex((x) => x.startsWith('fsync')); const j = m.log.findIndex((x) => x.startsWith('rename'));
    ok(i >= 0 && j > i, 'the temp file is flushed before the rename'); eq(m.fsyncs[0], `${F}.4242.tmp`, 'the temp file');
    const m2 = new MemFs(); m2.fsyncFile = (): void => { throw new Error('no fsync here'); }; ok(make(m2, api).put(tpl()).ok, 'a failing fsync does not fail the save');
  },
  staleTemps(api) {
    const m = new MemFs(); const dead = `${F}.9001.tmp`, own = `${F}.4242.tmp`, live = `${F}.9002.tmp`, other = `${ROOT}${path.sep}other.9001.tmp`, odd = `${F}.abc.tmp`;
    for (const f of [dead, own, live, other, odd]) m.set(f, 'brief text');
    make(m, api, (pid) => pid === 9002);
    ok(!m.files.has(dead), 'a dead process temp is removed'); ok(m.files.has(own), 'our own pid is kept'); ok(m.files.has(live), 'a live process temp is kept');
    ok(m.files.has(other) && m.files.has(odd), 'other names are kept');
  },
  format(api) {
    const m = new MemFs(); const s = make(m, api); s.put(tpl());
    const j = JSON.parse(m.text(F)!) as Record<string, unknown>; eq(j.format, 'agent-durbar-team-templates', 'format'); eq(j.schemaVersion, 1, 'schemaVersion'); ok(!('version' in j), 'no old version key');
    ok(Array.isArray(j.templates), 'templates'); eq(typeof api.MIGRATIONS, 'object', 'migrations table exists'); eq(api.SCHEMA_VERSION, 1, 'current version');
  },
  cap(api) {
    const m = new MemFs(); const s = make(m, api);
    for (let i = 0; i < 50; i++) ok(s.put(tpl('Team ' + i)).ok, 'put ' + i);
    eq(s.list().length, 50, '50 stored'); const w = m.writes.length;
    const r = s.put(tpl('One too many')); ok(!r.ok, 'the 51st is refused'); eq(s.list().length, 50, 'still 50'); eq(m.writes.length, w, 'nothing written');
    ok(!s.duplicate(s.list()[0].id).ok, 'duplicate at 50 refused');
    const first = s.list()[0]; ok(s.put({ ...first, name: 'Renamed' }).ok, 'an update at 50 is fine');
    ok(s.delete(first.id).ok, 'delete'); ok(s.put(tpl('Fits again')).ok, 'room again');
    // a file with 51: the first 50 are kept, the file is set aside
    const m2 = new MemFs(); m2.set(F, doc(...Array.from({ length: 51 }, (_, i) => stored('t' + i, 'N' + i))));
    const s2 = make(m2, api); eq(s2.list().length, 50, 'a file of 51 loads 50'); eq(badNames(m2).length, 1, 'and is kept aside');
  },
  duplicateNames(api) {
    const m = new MemFs(); const s = make(m, api);
    const a = s.putImported(tpl('Review crew', { description: 'd', members: [member('A', { memberId: 'a'.repeat(32), brief: 'Check it.', briefFrom: 'file' }), member('B')] }));
    ok(a.ok, 'put'); if (!a.ok) return;
    const d1 = s.duplicate(a.template.id); ok(d1.ok, 'duplicate'); if (!d1.ok) return;
    eq(d1.template.name, 'Review crew copy', 'name with copy'); eq(d1.template.origin, 'own', 'origin own'); ok(d1.template.id !== a.template.id, 'new id');
    eq(d1.template.members[0].briefFrom, 'file', 'briefFrom copied'); ok(d1.template.members.every((x) => x.memberId === undefined), 'no memberId carried over'); eq(d1.template.description, 'd', 'description');
    const d2 = s.duplicate(a.template.id); ok(d2.ok && d2.template.name === 'Review crew copy 2', 'second copy gets 2');
    ok(!s.duplicate('nope').ok, 'unknown id');
    // an NFD spelling and a Cyrillic lookalike of the first name take the suffix
    const m2 = new MemFs(); const s2 = make(m2, api);
    const nfd = s2.put(tpl('Café copy')); ok(nfd.ok, 'nfd');
    const caf = s2.put(tpl('Café')); ok(caf.ok, 'nfc'); if (!caf.ok) return;
    const dn = s2.duplicate(caf.template.id); ok(dn.ok && dn.template.name === 'Café copy 2', 'NFD twin takes the suffix: ' + (dn.ok ? dn.template.name : ''));
    const cy = s2.put(tpl('Arсhitect copy')); ok(cy.ok, 'cyrillic es'); // U+0441 looks like c
    const lat = s2.put(tpl('Architect')); ok(lat.ok, 'latin'); if (!lat.ok) return;
    const dc = s2.duplicate(lat.template.id); ok(dc.ok && dc.template.name === 'Architect copy 2', 'Cyrillic twin takes the suffix: ' + (dc.ok ? dc.template.name : ''));
    // a 40-character name keeps the suffix inside the limit
    const long = s2.put(tpl('L'.repeat(40))); ok(long.ok, 'long'); if (!long.ok) return;
    const dl = s2.duplicate(long.template.id); ok(dl.ok && dl.template.name.length <= 40 && dl.template.name.endsWith(' copy'), 'long name truncated');
    const emo = s2.put(tpl('\u{1F600}'.repeat(40))); ok(emo.ok, 'forty emoji'); if (!emo.ok) return;
    const de = s2.duplicate(emo.template.id); ok(de.ok && Array.from(de.template.name).length <= 40 && de.template.name.endsWith(' copy') && !de.template.name.includes('\uFFFD') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(de.template.name), 'emoji name cut by code point: ' + (de.ok ? Array.from(de.template.name).length : ''));
    ok(de.ok && Array.from(de.template.name).length === 40, 'filled to 40 code points');
    const sp = s2.put(tpl('x'.repeat(34) + ' yyyy')); if (sp.ok) { const ds = s2.duplicate(sp.template.id); ok(ds.ok && ds.template.name === 'x'.repeat(34) + ' copy', 'no double space before the suffix: ' + (ds.ok ? ds.template.name : '')); }
    // by grapheme: a conjunct or an emoji sequence is never split
    const KSSA = '\u0915\u094D\u0937'; const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    const dv = s2.put(tpl(KSSA.repeat(13))); ok(dv.ok, 'devanagari'); if (dv.ok) {
      const dd = s2.duplicate(dv.template.id); ok(dd.ok && dd.template.name === KSSA.repeat(11) + ' copy', 'conjuncts kept whole, no dangling virama: ' + (dd.ok ? Array.from(dd.template.name).length : ''));
    }
    const fm = s2.put(tpl('B'.repeat(32) + FAMILY + 'x')); ok(fm.ok, 'family emoji name'); if (fm.ok) {
      const df = s2.duplicate(fm.template.id); ok(df.ok && df.template.name === 'B'.repeat(32) + ' copy', 'the family emoji is dropped whole, never cut: ' + (df.ok ? JSON.stringify(df.template.name) : ''));
    }
    const zj = s2.put(tpl('C'.repeat(34) + '\u200D' + 'yyy')); if (zj.ok) { const dz = s2.duplicate(zj.template.id); ok(dz.ok && dz.template.name === 'C'.repeat(34) + ' copy', 'a trailing ZWJ is dropped before the suffix'); }
    const dl2 = s2.duplicate(long.template.id); ok(dl2.ok && dl2.template.name.length <= 40 && dl2.template.name.endsWith(' copy 2') && dl2.template.name !== (dl.ok ? dl.template.name : ''), 'and again');
  },
  putInvalid(api) {
    const m = new MemFs(); const s = make(m, api);
    ok(s.put(tpl()).ok, 'one valid'); const w = m.writes.length; const before = m.text(F);
    const secret = 'sk-' + 'test-' + 'PLANTEDSECRET0123456789';
    for (const bad of [null, 'x', 42, [], {}, { name: '', members: [member()] }, { name: 'X', members: [] }, { name: 'X', members: [member('A', { app: 7 })] }, { name: 'X', members: [member('A', { shell: secret })] }, { name: 'X', members: [member('A', { memberId: 'nothex' })] }, { name: 'X', members: [member('A'), member('A')] }]) {
      const r = api === undefined ? undefined : s.put(bad);
      ok(r !== undefined && !r.ok, 'refused: ' + JSON.stringify(bad)?.slice(0, 30));
      if (r && !r.ok) ok(r.errors.length > 0 && !r.errors.join(' ').includes(secret), 'errors name fields, not values');
    }
    eq(m.writes.length, w, 'no write for any refused put'); eq(m.text(F), before, 'disk untouched'); eq(s.list().length, 1, 'memory untouched');
    ok(!s.put({ name: 'X', members: [member('A', { brief: 'x'.repeat(4001) })] }).ok, 'brief too long');
  },
  deleteAndMissing(api) {
    const m = new MemFs(); const s = make(m, api); const a = s.put(tpl()); if (!a.ok) return ok(false, 'put');
    const w = m.writes.length;
    const none = s.delete('doesnotexist'); ok(none.ok && !none.removed, 'unknown id: nothing removed'); eq(m.writes.length, w, 'no write'); eq(s.list().length, 1, 'kept');
    const del = s.delete(a.template.id); ok(del.ok && del.removed, 'removed'); eq(s.list(), [], 'empty'); eq(make(m, api).list(), [], 'and on disk');
  },
  importedFileLoads(api) {
    const m = new MemFs();
    const t = stored('imp1', 'From a file', { origin: 'imported', members: [member('A', { memberId: 'b'.repeat(32), brief: 'x'.repeat(1990), briefFrom: 'file' })] });
    m.set(F, doc(t)); const s = make(m, api);
    const l = s.list(); eq(l.length, 1, 'loaded'); eq(badNames(m).length, 0, 'not set aside'); ok(!s.takeToast(), 'no toast');
    eq(l[0].origin, 'imported', 'origin kept'); eq(l[0].members[0].briefFrom, 'file', 'briefFrom kept'); eq(l[0].members[0].memberId, 'b'.repeat(32), 'memberId kept');
    ok(s.put({ ...l[0], name: 'Edited' }).ok, 'and can be edited'); eq(s.get('imp1')!.origin, 'imported', 'stays imported');
  },
  boundedRead(api) {
    const m = new MemFs(); m.files.set(F, { data: Buffer.from('{"version":1,"templates":['), mode: 0o600, size: 400 * 1024 * 1024 });
    const s = make(m, api); eq(s.list(), [], 'empty'); eq(m.bytesRead, 0, 'nothing of a huge file is read'); eq(badNames(m).length, 1, 'set aside'); ok(s.takeToast(), 'toast');
    // a file that grows while it is read
    const m2 = new MemFs(); m2.files.set(F, { data: Buffer.from('x'.repeat(100)), mode: 0o600, size: 10 }); make(m2, api); eq(badNames(m2).length, 1, 'a changing file is set aside');
    // a missing file is simply empty
    const m3 = new MemFs(); make(m3, api); eq(m3.names(), [], 'no file, no bad file, nothing written');
  },
  readRetry(api) {
    const text = doc(stored('keep1', 'Held for a moment'));
    const m = new MemFs(); m.set(F, text); m.openFails = 1; const s = make(m, api);
    eq(s.list().map((t) => t.name), ['Held for a moment'], 'one failed read: the file is read again'); eq(pauses, [200], 'one pause of about 200 ms'); eq(badNames(m).length, 0, 'not set aside'); ok(!s.takeToast(), 'no toast');
    pauses = []; const m2 = new MemFs(); m2.set(F, text); m2.openFails = 2; const s2 = make(m2, api);
    eq(s2.list(), [], 'two failed reads: empty'); eq(badNames(m2).length, 1, 'set aside only after the second'); eq(pauses, [200], 'still one pause'); eq(m2.text(badNames(m2)[0]), text, 'kept whole'); ok(s2.takeToast(), 'toast');
    pauses = []; const m3 = new MemFs(); m3.files.set(F, { data: Buffer.from('x'.repeat(100)), mode: 0o600, size: 10 }); make(m3, api);
    eq(pauses, [200], 'a changing file is read again once'); eq(badNames(m3).length, 1, 'then set aside');
    pauses = []; const m4 = new MemFs(); m4.files.set(F, { data: Buffer.from('{}'), mode: 0o600, size: 400 * 1024 * 1024 }); make(m4, api); eq(pauses, [], 'a too-big file is not retried');
  },
  badUtf8(api) {
    const head = Buffer.from('{"format":"agent-durbar-team-templates","schemaVersion":1,"templates":[{"id":"u1","name":"');
    const tail = Buffer.from('","origin":"own","createdAt":1,"updatedAt":2,"members":[{"name":"A","role":"r","app":"copilot","permMode":"ask","sendBrief":true}]}]}');
    const bytes = Buffer.concat([head, Buffer.from([0xff, 0xfe, 0xc3]), tail]);
    const m = new MemFs(); m.set(F, bytes); const s = make(m, api);
    eq(s.list(), [], 'bad UTF-8 is a bad file'); eq(badNames(m).length, 1, 'set aside'); ok(m.files.get(badNames(m)[0])!.data.equals(bytes), 'bytes kept as they were'); ok(s.takeToast(), 'toast');
    const good = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(doc(stored('bom1', 'With a BOM')))]);
    const m2 = new MemFs(); m2.set(F, good); eq(make(m2, api).list().length, 1, 'a BOM is stripped and the file loads');
  },
  winRename(api) {
    const flaky = (m: MemFs, code: string, times: number, dest: (to: string) => boolean): void => {
      let left = times; const orig = m.renameSync.bind(m);
      m.renameSync = (a: string, b: string): void => { if (left > 0 && dest(b)) { left--; throw Object.assign(new Error('held'), { code }); } orig(a, b); };
    };
    for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
      const m = new MemFs(); const s = make(m, api, () => false, 'win32'); flaky(m, code, 1, (to) => to === F);
      ok(s.put(tpl()).ok, 'win32 ' + code + ': the save is retried'); eq(pauses, [200], 'one pause'); pauses = [];
      const m2 = new MemFs(); m2.set(F, '{broken'); flaky(m2, code, 1, (to) => to.includes('.bad-')); const s2 = make(m2, api, () => false, 'win32');
      eq(badNames(m2).length, 1, 'win32 ' + code + ': the set-aside is retried'); ok(!s2.isBlocked(), 'not blocked'); eq(pauses, [200], 'one pause'); pauses = [];
    }
    const m3 = new MemFs(); const s3 = make(m3, api, () => false, 'win32'); flaky(m3, 'EPERM', 2, (to) => to === F); ok(!s3.put(tpl()).ok, 'only one retry'); eq(m3.names(), [], 'no temp left');
    pauses = []; const m4 = new MemFs(); const s4 = make(m4, api, () => false, 'linux'); flaky(m4, 'EPERM', 1, (to) => to === F); ok(!s4.put(tpl()).ok, 'no retry off Windows'); eq(pauses, [], 'no pause');
    const m5 = new MemFs(); const s5 = make(m5, api, () => false, 'win32'); flaky(m5, 'ENOSPC', 1, (to) => to === F); ok(!s5.put(tpl()).ok, 'other errors are not retried');
  },
  twoInstances(api) {
    const m = new MemFs(); const a = make(m, api); const b = make(m, api);
    ok(a.put(tpl('FromA')).ok, 'A saves');
    const r = b.put(tpl('FromB')); ok(!r.ok && r.errors[0] === 'changed', 'B, with an old fingerprint, is refused: changed');
    eq(m.text(F)!.includes('FromB'), false, 'nothing of B written'); ok(m.text(F)!.includes('FromA'), 'A is not lost');
    eq(b.list().map((t) => t.name), ['FromA'], 'B reloaded what A saved');
    ok(b.put(tpl('FromB')).ok, 'B saves now'); eq(make(m, api).list().map((t) => t.name), ['FromA', 'FromB'], 'both kept');
    const aId = a.list()[0].id; const d = a.delete(aId); ok(!d.ok && d.errors[0] === 'changed', 'A is refused too (delete)'); eq(a.list().length, 2, 'A reloaded');
    ok(a.delete(aId).ok, 'and then deletes'); eq(make(m, api).list().map((t) => t.name), ['FromB'], 'one left');
    const m2 = new MemFs(); const c = make(m2, api); c.put(tpl('One')); ok(c.put(tpl('Two')).ok && c.put(tpl('Three')).ok, 'one instance saves again and again');
    // the file removed behind the store's back is a change too
    m2.files.delete(F); ok(!c.put(tpl('Four')).ok, 'a vanished file is a change');
  },
  pruneBad(api) {
    const m = new MemFs();
    for (let i = 0; i < 8; i++) { m.set(F, '{bad ' + i); new api.TeamTemplateStore(F, { fs: m, flags: KEYS, now: () => 1_700_000_000_000 + i * 1000, pause: () => undefined }); }
    const names = badNames(m); eq(names.length, 5, 'only the newest 5 are kept');
    const texts = names.map((x) => m.text(x)).sort(); eq(texts, ['{bad 3', '{bad 4', '{bad 5', '{bad 6', '{bad 7'], 'the oldest were removed');
    m.set(`${ROOT}${path.sep}notes.bad-1.json`, 'x'); m.set(F, '{bad 9'); new api.TeamTemplateStore(F, { fs: m, flags: KEYS, now: () => 1_700_000_100_000, pause: () => undefined }); ok(m.files.has(`${ROOT}${path.sep}notes.bad-1.json`), 'other files are not touched');
  },
  pruneStrict(api) {
    const m = new MemFs(); const S = new Date(1_700_000_000_000).toISOString().replace(/[:.]/g, '-'); const nm = (suffix: string): string => path.join(ROOT, `team-templates.bad-${S}${suffix}.json`);
    for (const x of ['', '-2', '-3', '-4', '-5', '-6', '-10']) m.set(nm(x), 'old' + x);
    const near = ['team-templates.bad-.json', 'team-templates.bad-notes.json', 'team-templates.badger.json', `team-templates.bad-${S}.json.keep`, 'team-templates.bad-x.txt', 'team-templates.bad-9999-99-99T99-99-99-999Z.json.bak'].map((x) => path.join(ROOT, x));
    for (const x of near) m.set(x, 'keep');
    m.set(F, '{bad now'); new api.TeamTemplateStore(F, { fs: m, flags: KEYS, now: () => 1_700_000_000_000, pause: () => undefined });
    for (const x of near) ok(m.files.has(x), 'untouched: ' + path.basename(x));
    const left = badNames(m).filter((x) => /Z(-\d+)?\.json$/.test(x)).map((x) => path.basename(x).slice(`team-templates.bad-${S}`.length, -5)).sort();
    eq(left, ['-10', '-4', '-5', '-6', '-7'], 'newest 5 by time then number: -10 comes after -2 and -7; names that only look alike do not count');
  },
  pruneKeepsNew(api) {
    // five old set-aside files dated far in the future and a broken store loaded now: the new one is the oldest by name, and still stays
    const m = new MemFs(); const old = [1, 2, 3, 4, 5].map((k) => path.join(ROOT, `team-templates.bad-2030-01-0${k}T00-00-00-000Z.json`));
    for (const x of old) m.set(x, 'old');
    m.set(F, '{bad new'); const s = make(m, api);
    const now = badNames(m); eq(now.length, 5, 'five set-aside files in all'); ok(now.some((x) => m.text(x) === '{bad new'), 'the file just set aside is not removed');
    ok(!m.files.has(old[0]), 'the oldest of the others went'); ok(s.takeToast(), 'toast');
  },
  pruneRegularOnly(api) {
    const m = new MemFs(); const S = (k: number): string => path.join(ROOT, `team-templates.bad-2020-01-0${k}T00-00-00-000Z.json`);
    for (const k of [1, 2, 3, 4]) m.set(S(k), 'file ' + k);
    const dir = path.join(ROOT, 'team-templates.bad-2019-01-01T00-00-00-000Z.json'); m.dirs.add(dir); // a folder with a set-aside name: not counted, not removed
    m.set(F, '{bad'); make(m, api);
    ok(m.dirs.has(dir), 'a folder is not removed'); eq(badNames(m).filter((x) => m.files.has(x)).length, 5, 'four old files and the new one, all kept: the folder does not count');
    m.set(F, '{bad 2'); new api.TeamTemplateStore(F, { fs: m, flags: KEYS, now: () => 1_800_000_000_000, pause: () => undefined });
    ok(!m.files.has(S(1)), 'the oldest regular file went'); ok(m.dirs.has(dir), 'the folder is still there');
  },
  sameSizeSameTime(api) {
    // another instance writes other bytes of the same size in the same mtime tick: size and time cannot tell, the content does
    const a = doc(stored('s1', 'AAAA')); const b = doc(stored('s1', 'BBBB')); eq(a.length, b.length, 'same size');
    const m = new MemFs(); m.set(F, a); const mt = m.files.get(F)!.mt; const s = make(m, api); eq(s.list()[0].name, 'AAAA', 'loaded');
    m.files.set(F, { data: Buffer.from(b), mode: 0o644, mt });
    const r = s.put(tpl('Mine')); ok(!r.ok && r.errors[0] === 'changed', 'same size, same mtime, other bytes: changed'); eq(s.list()[0].name, 'BBBB', 'reloaded'); ok(!m.text(F)!.includes('Mine'), 'not overwritten');
    // a file created or removed between is a change too
    const m2 = new MemFs(); const s2 = make(m2, api); m2.set(F, doc(stored('c1', 'Created'))); ok(!s2.put(tpl('X')).ok, 'a file that appeared is a change'); eq(s2.list().map((t) => t.name), ['Created'], 'and is read');
    const m3 = new MemFs(); m3.set(F, doc(stored('d1', 'Gone'))); const s3 = make(m3, api); m3.files.delete(F); const r3 = s3.put(tpl('Y')); ok(!r3.ok && r3.errors[0] === 'changed', 'a file that vanished is a change');
    // an unchanged file is saved, again and again
    const m4 = new MemFs(); m4.set(F, a); const s4 = make(m4, api); ok(s4.put(tpl('One')).ok && s4.put(tpl('Two')).ok, 'no change, no refusal');
  },
  hashRetry(api) {
    const m = new MemFs(); const s = make(m, api); ok(s.put(tpl('One')).ok, 'first save'); pauses = [];
    m.openFails = 1; ok(s.put(tpl('Two')).ok, 'one EBUSY on the read before a save: the save passes'); eq(pauses, [200], 'after one pause'); eq(make(m, api).list().length, 2, 'both saved');
    pauses = []; const before = m.text(F); m.openFails = 2; const r = s.put(tpl('Three')); ok(!r.ok && r.errors[0] === 'The team templates could not be saved.', 'two in a row: an ordinary failed save, not `changed`'); eq(pauses, [200], 'one pause'); eq(badNames(m).length, 0, 'the good file is NOT set aside'); eq(m.text(F), before, 'and is untouched'); eq(s.list().length, 2, 'memory as it was');
    ok(s.put(tpl('Four')).ok, 'and the next save works');
  },
  unreadableSave(api) {
    // four failed reads in a row, or a file with no permission (a persistent error on the injected fs): the save fails like any failed save;
    // nothing is reloaded, set aside or toasted, the file is byte for byte as it was, and the next save works once the fault is gone
    for (const fails of [4, 99]) {
      const m = new MemFs(); const s = make(m, api); ok(s.put(tpl('One')).ok, 'first save'); ok(s.takeToast() === false, 'no toast yet');
      const before = m.text(F); const mt = m.files.get(F)!.mt; pauses = [];
      m.openFails = fails; const r = s.put(tpl('Two')); ok(!r.ok && r.errors[0] !== 'changed' && r.errors.length > 0, 'the save fails, as an ordinary failed save: ' + fails);
        ok(!r.ok && r.errors[0] === 'The team templates could not be saved.', 'with the usual error');
      eq(m.text(F), before, 'file byte for byte the same'); eq(m.files.get(F)!.mt, mt, 'not even rewritten'); eq(badNames(m).length, 0, 'no set-aside file'); ok(!s.takeToast(), 'no toast'); ok(!s.isBlocked(), 'not blocked');
      eq(s.list().map((t) => t.name), ['One'], 'memory unchanged'); eq(m.names(), [F], 'no temp left');
      m.openFails = 0; ok(s.put(tpl('Three')).ok, 'the next save works'); eq(make(m, api).list().map((t) => t.name), ['One', 'Three'], 'both on disk');
    }
    // a link or a folder in place of the file is a change, not a read failure
    const m2 = new MemFs(); const s2 = make(m2, api); s2.put(tpl('One'));
    m2.files.set(F, { data: Buffer.from('x'), mode: 0o600, size: 400 * 1024 * 1024, mt: 99 }); const r2 = s2.put(tpl('Two')); ok(!r2.ok && r2.errors[0] === 'changed', 'a too-big file in its place: changed');
  },
  danglingLink(api) {
    // a dangling symlink as the store file: it is a bad file (a link), set aside by a rename of the link itself; the next save works
    const S = new Date(1_700_000_000_000).toISOString().replace(/[:.]/g, '-'); const bad1 = path.join(ROOT, `team-templates.bad-${S}.json`); const bad2 = path.join(ROOT, `team-templates.bad-${S}-2.json`);
    const m = new MemFs(); m.dangling.add(F); const s = make(m, api); eq(s.list(), [], 'empty');
    ok(!m.dangling.has(F), 'the link is moved away'); eq([...m.dangling].filter((x) => x.includes('.bad-')).length, 1, 'the link itself is set aside'); ok(s.takeToast(), 'one toast'); ok(!s.isBlocked(), 'not blocked');
    ok(s.put(tpl()).ok, 'the next save works'); eq(make(m, api).list().length, 1, 'and is on disk');
    // the first set-aside name is itself a dangling link: the next free name is taken, the link there is not replaced
    const m2 = new MemFs(); m2.dangling.add(F); m2.dangling.add(bad1); const s2 = new api.TeamTemplateStore(F, { fs: m2, flags: KEYS, now: () => 1_700_000_000_000, pause: () => undefined });
    ok(m2.dangling.has(bad1), 'a link at the set-aside name is kept'); ok(m2.dangling.has(bad2), 'and the file went to the next name'); ok(!m2.dangling.has(F), 'link moved'); ok(s2.put(tpl()).ok, 'saves');
    // the link appears under a running store: the save is a change, the link is set aside, the next save works
    const m3 = new MemFs(); const s3 = make(m3, api); s3.put(tpl()); m3.files.delete(F); m3.dangling.add(F);
    const r = s3.put(tpl('Two')); ok(!r.ok && r.errors[0] === 'changed', 'a link under a running store: changed'); ok(!m3.dangling.has(F), 'link set aside'); ok(s3.put(tpl('Three')).ok, 'then saves');
  },
  blockedReread(api) {
    // the folder has no search permission at the start: the store is blocked, no toast; when the permission is back, the GOOD file is reloaded, never set aside
    const text = doc(stored('good1', 'Good1'));
    const m = new MemFs(); m.set(F, text); m.denied = true; const s = make(m, api);
    ok(s.isBlocked(), 'blocked at the start'); ok(!s.takeToast(), 'no toast'); eq(s.list(), [], 'nothing listed'); ok(!s.put(tpl('After')).ok, 'put fails while the permission is out'); eq(m.text(F), text, 'file untouched');
    m.denied = false;
    const r = s.put(tpl('After')); ok(!r.ok && r.errors[0] === 'changed', 'the first save after the permission is back answers changed'); eq(s.list().map((t) => t.name), ['Good1'], 'Good1 is in the list');
    eq(badNames(m).length, 0, 'no set-aside file'); ok(!s.takeToast(), 'no toast'); ok(!s.isBlocked(), 'no longer blocked'); eq(m.text(F), text, 'file untouched');
    ok(s.put(tpl('After')).ok, 'the second save works'); eq(make(m, api).list().map((t) => t.name), ['Good1', 'After'], 'both on disk');
    // a bad file that could not be moved and is still bad when the move works: set aside, then the save goes through (as before)
    const m2 = new MemFs(); m2.set(F, '{broken'); m2.denied = false; let down = true; const orig = m2.renameSync.bind(m2);
    m2.renameSync = (a: string, b: string): void => { if (down && a === F) throw Object.assign(new Error('x'), { code: 'EXDEV' }); orig(a, b); };
    const s2 = make(m2, api); ok(s2.isBlocked(), 'blocked'); down = false; ok(s2.put(tpl('Fresh')).ok, 'still-bad file is set aside and the save works'); eq(badNames(m2).length, 1, 'one bad file');
    // while the file stays unreadable the save just fails
    const m3 = new MemFs(); m3.set(F, text); m3.denied = true; const s3 = make(m3, api); ok(!s3.put(tpl('X')).ok, 'fails'); ok(!s3.put(tpl('Y')).ok, 'fails again'); m3.denied = false; eq(badNames(m3).length, 0, 'nothing set aside meanwhile');
  },
  longGrapheme(api) {
    const m = new MemFs(); const s = make(m, api); const name = 'a' + '\u0301'.repeat(39);
    const t = s.put(tpl(name)); ok(t.ok, 'a name that is one grapheme'); if (!t.ok) return;
    const d = s.duplicate(t.template.id); ok(d.ok && d.template.name.endsWith(' copy') && d.template.name.length > ' copy'.length + 3 && d.template.name.startsWith('a'), 'one huge grapheme: cut by code point, the name is not lost: ' + (d.ok ? d.template.name.length : ''));
  },
  lateWrite(api) {
    // another instance writes the file after this one has read it (before the fingerprint would be taken, if it were taken after the read)
    const m = new MemFs(); m.set(F, doc(stored('late0', 'Before')));
    m.afterRead = (): void => { m.set(F, doc(stored('late0', 'Before'), stored('late1', 'Late from the other'))); };
    const s = make(m, api); eq(s.list().map((t) => t.name), ['Before'], 'read what was there');
    const r = s.put(tpl('Mine')); ok(!r.ok && r.errors[0] === 'changed', 'a write between the read and the fingerprint is seen: changed');
    ok(m.text(F)!.includes('Late from the other') && !m.text(F)!.includes('Mine'), 'the other one is not lost'); eq(s.list().map((t) => t.name), ['Before', 'Late from the other'], 'reloaded');
  },
  blockedFlag(api) {
    const m = new MemFs(); m.set(F, '{broken'); let down = true;
    const orig = m.renameSync.bind(m); m.renameSync = (a: string, b: string): void => { if (down && a === F) throw Object.assign(new Error('x'), { code: 'EXDEV' }); orig(a, b); };
    const s = make(m, api); ok(s.isBlocked(), 'blocked while the bad file cannot move'); ok(!s.put(tpl()).ok, 'saves refused'); ok(s.isBlocked(), 'still blocked');
    down = false; ok(s.put(tpl()).ok, 'saves after the move works'); ok(!s.isBlocked(), 'no longer blocked');
    ok(!make(new MemFs(), api).isBlocked(), 'a normal store is not blocked');
  },
  crlf(api) {
    const m = new MemFs(); const text = doc(stored('crlf1', 'Windows file', { members: [member('A', { brief: 'one\r\ntwo' })] }));
    m.set(F, '﻿' + text.replace(/\n/g, '\r\n')); const s = make(m, api);
    eq(s.list().length, 1, 'CRLF (and a BOM) read'); eq(badNames(m).length, 0, 'not set aside');
    const b = s.list()[0].members[0].brief; ok(b !== undefined && !b.includes('\r'), 'a CRLF inside a brief is read as LF'); eq(b, 'one\ntwo', 'brief lines');
  },
  speed(api) {
    const m = new MemFs(); m.set(F, '{"version":1,"templates":[' + '[' .repeat(190000)); const t0 = Date.now(); make(m, api); ok(Date.now() - t0 < 2000, 'a deeply nested 190k file is refused in time');
    const m2 = new MemFs(); m2.set(F, doc(stored('s1', 'N'.repeat(200000)))); const t1 = Date.now(); make(m2, api); ok(Date.now() - t1 < 2000, 'a 200k name is refused in time');
  },
};

const run = (api: Api): string[] => {
  const failed: string[] = []; seq = 0; clock = 1_700_000_000_000; pauses = [];
  for (const [name, fn] of Object.entries(sections)) { pauses = []; try { fn(api); } catch { failed.push(name); } } // a mutant may also crash: that is a kill
  return failed;
};

seq = 0; clock = 1_700_000_000_000; pauses = [];
for (const [name, fn] of Object.entries(sections)) { pauses = []; try { fn(real); } catch (e) { console.error('section ' + name + ' failed'); throw e; } }
const checks = n;

// ---- mutants ----
const dir = path.join(__dirname, '..', 'src', 'main');
const compiled = fs.readFileSync(path.join(dir, 'teamstore.js'), 'utf8');
const mutants: { name: string; from: string; to: string; breaks: string }[] = [
  { name: 'write straight to the file, no temp and no rename', from: 'const tmp = `${this.file}.${this.pid}.tmp`;', to: 'const tmp = this.file;', breaks: 'crashBetweenWriteAndRename' },
  { name: 'file mode 0644', from: '{ mode: 0o600, flag: \'wx\' }', to: '{ mode: 0o644, flag: \'wx\' }', breaks: 'fileMode' },
  { name: 'bad file set aside without the toast flag', from: 'this.toast = true;', to: '', breaks: 'brokenSetAside' },
  { name: 'the cap of 50 off by one', from: '!cur && this.items.length >= teamtemplate_1.LIMITS.templates)', to: '!cur && this.items.length > teamtemplate_1.LIMITS.templates)', breaks: 'cap' },
  { name: 'duplicate name compared without nameKey', from: 'new Set(this.items.map((x) => (0, skeleton_1.nameKey)(x.name)))', to: 'new Set(this.items.map((x) => x.name))', breaks: 'duplicateNames' },
  { name: 'duplicate name tested without nameKey (candidate)', from: 'if (!taken.has((0, skeleton_1.nameKey)(name)))', to: 'if (!taken.has(name))', breaks: 'duplicateNames' },
  { name: 'put without validation', from: 'const r = (0, teamtemplate_1.checkTeamTemplate)(value, \'own\');', to: 'const r = { ok: true, template: value, ignored: 0 };', breaks: 'putInvalid' },
  { name: 'put takes the origin of the value', from: "origin: cur ? cur.origin : imported ? 'imported' : 'own'", to: "origin: cur ? cur.origin : (t.origin ?? (imported ? 'imported' : 'own'))", breaks: 'basics' },
  { name: 'no fsync before the rename', from: 'this.fs.fsyncFile(tmp);', to: '', breaks: 'fsyncBeforeRename' },
  { name: 'blocked check removed', from: 'if (!this.setAside())\n                return \'failed\';', to: '', breaks: 'brokenSetAside' },
  { name: 'old version key accepted (format not checked)', from: 'doc.format === FORMAT && ', to: '', breaks: 'brokenSetAside' },
  { name: 'a newer schemaVersion accepted', from: 'v <= exports.SCHEMA_VERSION', to: 'v <= 99', breaks: 'brokenSetAside' },
  { name: 'duplicate cut by code point, not grapheme', from: 'const base = graphemes(src.name);', to: 'const base = Array.from(src.name);', breaks: 'duplicateNames' },
  { name: 'trailing joiners kept before the suffix', from: ".replace(TRAILING_JOINERS, '')", to: '', breaks: 'duplicateNames' },
  { name: 'a read error sets the file aside at once (no second read)', from: "if (!r.ok && (r.code === 'error' || r.code === 'changing'))", to: 'if (false)', breaks: 'readRetry' },
  { name: 'decoder not fatal (U+FFFD written in)', from: "{ fatal: true }", to: '{ fatal: false }', breaks: 'badUtf8' },
  { name: 'no Windows rename retry', from: "this.platform === 'win32' && ", to: 'false && ', breaks: 'winRename' },
  { name: 'Windows retry on every platform', from: "this.platform === 'win32' && ", to: '', breaks: 'winRename' },
  { name: 'no fingerprint comparison before a save', from: 'now.kind !== \'hash\' || now.hash !== this.fp', to: 'false', breaks: 'twoInstances' },
  { name: 'old set-aside files not pruned', from: 'found.slice(0, Math.max(0, found.length - (exports.KEEP_BAD - 1)))', to: '[]', breaks: 'pruneBad' },
  { name: 'folder made with mode 0755', from: 'recursive: true, mode: 0o700', to: 'recursive: true, mode: 0o755', breaks: 'fileMode' },
  { name: 'prune filter loose (prefix and extension only)', from: 're.exec(name)', to: "(name.startsWith('team-templates.bad-') && name.endsWith('.json') ? [name, name.slice(19, -5), undefined] : null)", breaks: 'pruneStrict' },
  { name: 'prune order by text, -10 before -2', from: 'x.n - y.n', to: '(String(x.n) < String(y.n) ? -1 : 1)', breaks: 'pruneStrict' },
  { name: 'hash taken after the read (a second read)', from: 'const seen = this.seen(r);', to: 'const seen = this.seenNow();', breaks: 'lateWrite' },
  { name: 'compares size only, not the content', from: "crypto.createHash('sha256').update(b).digest('hex')", to: 'String(b.length)', breaks: 'sameSizeSameTime' },
  { name: 'the file just set aside may be pruned', from: 'name !== path.basename(dest) && ', to: '', breaks: 'pruneKeepsNew' },
  { name: 'prune counts and removes folders', from: 'this.isRegular(path.join(dir, name))', to: 'true', breaks: 'pruneRegularOnly' },
  { name: 'the read before a save is not retried', from: 'return this.seen(this.readFile());', to: 'return this.seen((0, cappedread_1.readCapped)(this.fs, this.flags, this.file, exports.MAX_STORE_BYTES));', breaks: 'hashRetry' },
  { name: 'the read retry has no pause', from: 'this.pause(200);\n            r = (0, cappedread_1.readCapped)', to: 'r = (0, cappedread_1.readCapped)', breaks: 'hashRetry' },
  { name: 'a persistent read error still reloads (and sets the good file aside)', from: "if (now.kind === 'busy')\n            return 'failed';", to: '', breaks: 'unreadableSave' },
  { name: 'two unreadable reads compare as one hash', from: "{ kind: 'busy' }", to: "{ kind: 'hash', hash: 'unreadable' }", breaks: 'unreadableSave' },
  { name: 'existsSync (follows a link) instead of lstat', from: 'this.fs.lstatSync(p);\n            return true;', to: 'this.fs.statSync(p);\n            return true;', breaks: 'danglingLink' },
  { name: 'any lstat error counts as absent', from: "if (e?.code === 'ENOENT')\n                return false;\n            throw e;", to: 'return false;', breaks: 'blockedReread' },
  { name: 'a blocked store sets the file aside without reading it again', from: 'if (r.ok && !this.parseDoc(r.buf).bad) {', to: 'if (false) {', breaks: 'blockedReread' },
  { name: 'one huge grapheme leaves only the suffix', from: 'head.length === 0)', to: 'false)', breaks: 'longGrapheme' },
  { name: 'isBlocked always false', from: 'isBlocked() { return this.blocked; }', to: 'isBlocked() { return false; }', breaks: 'blockedFlag' },
  { name: 'stale temps not removed', from: '(0, schedules_1.removeStaleTemps)(this.file,', to: '(() => undefined)(this.file,', breaks: 'staleTemps' },
  { name: 'load at level imported', from: '(0, teamtemplate_1.checkTeamTemplate)(raw, \'own\')', to: '(0, teamtemplate_1.checkTeamTemplate)(raw, \'imported\')', breaks: 'importedFileLoads' },
];
let killed = 0;
for (const m of mutants) {
  assert.ok(compiled.includes(m.from), 'mutant anchor not found: ' + m.name);
  const file = path.join(dir, 'teamstore.mutant.js');
  fs.writeFileSync(file, compiled.split(m.from).join(m.to));
  try {
    delete require.cache[file];
    const api = require(file) as Api;
    const failed = run(api);
    assert.ok(failed.includes(m.breaks), `mutant NOT killed by section ${m.breaks}: ${m.name} (failed: ${failed.join(',') || 'none'})`);
    killed++;
  } finally {
    fs.rmSync(file, { force: true });
  }
}
assert.strictEqual(killed, mutants.length);
console.log(`test-teamstore: ${checks} checks passed, ${killed} mutants killed`);
