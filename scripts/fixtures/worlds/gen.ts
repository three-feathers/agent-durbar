/**
 * Synthetic world packs for the tests (spec 102 FR-180, T016): drawn by script, no generated art, nothing committed as binary. The "pictures"
 * are header-valid stand-ins (no decoder exists in Node; real decoding happens in the encoder window, a later phase), sized and capped as real
 * parts. `rawZip` builds zips the strict writer would never make, one field at a time, for the hostile set.
 * Everything is in memory; `scripts/make-world-fixtures.js` writes it to a folder the caller names.
 */
import * as zlib from 'zlib';
import { crc32, writeStoredZip } from '../../../src/shared/worldzip';
import { PART_TABLE } from '../../../src/shared/worldpack';

export const le16 = (n: number): Buffer => { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; };
export const le32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const be32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };

// ---- pictures ----
function chunk(id: string, data: Buffer): Buffer { return Buffer.concat([Buffer.from(id, 'latin1'), le32(data.length), data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]); }
function riff(chunks: Buffer[]): Buffer { const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]); return Buffer.concat([Buffer.from('RIFF'), le32(body.length), body]); }
export function vp8l(w: number, h: number, pad = 24): Buffer { const d = Buffer.alloc(Math.max(5, pad), 7); d[0] = 0x2f; d.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14) | (1 << 28), 1); return chunk('VP8L', d); }
export function vp8(w: number, h: number): Buffer { const d = Buffer.alloc(30, 3); d[3] = 0x9d; d[4] = 0x01; d[5] = 0x2a; d.writeUInt16LE(w, 6); d.writeUInt16LE(h, 8); return chunk('VP8 ', d); }
export function vp8x(w: number, h: number, flags: number): Buffer { const d = Buffer.alloc(10); d[0] = flags; d.writeUIntLE(w - 1, 4, 3); d.writeUIntLE(h - 1, 7, 3); return chunk('VP8X', d); }
/** A header-valid WebP of the given size; `pad` grows the picture data to reach a byte size. */
export function webp(w: number, h: number, pad = 24): Buffer { return riff([vp8l(w, h, pad)]); }
export function webpOfSize(w: number, h: number, bytes: number): Buffer { const base = webp(w, h).length; return webp(w, h, 24 + Math.max(0, bytes - base)); }
export function pngChunk(type: string, data: Buffer): Buffer { const t = Buffer.from(type, 'latin1'); return Buffer.concat([be32(data.length), t, data, be32(crc32(Buffer.concat([t, data])))]); }
export function png(w: number, h: number, extra: Buffer[] = [], opts: { iend?: boolean; trailing?: Buffer } = {}): Buffer {
  const ihdr = Buffer.concat([be32(w), be32(h), Buffer.from([8, 6, 0, 0, 0])]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), ...extra, pngChunk('IDAT', Buffer.alloc(40, 1)), ...(opts.iend === false ? [] : [pngChunk('IEND', Buffer.alloc(0))]), ...(opts.trailing ? [opts.trailing] : [])]);
}

// ---- the good pack ----
const DIMS: Record<string, [number, number]> = {
  'wall.webp': [600, 200], 'floor.webp': [256, 256], 'welcome.webp': [1600, 1000], 'window-1.webp': [120, 200], 'window-2.webp': [120, 200], 'window-3.webp': [120, 200],
  'desk.webp': [400, 200], 'desk-half.webp': [200, 100], 'lift-shaft.webp': [60, 400], 'lift-cover.webp': [800, 600], 'lift-cutaway.webp': [600, 500],
  'speech-bubble.webp': [300, 120], 'slip.webp': [300, 100], 'panel-frame.webp': [400, 300], 'panel-backdrop.webp': [800, 600],
};
export const goodAnchors = (name: string): Record<string, unknown> => {
  if (name.startsWith('fx-')) return { standX: 0.5, plateAnchor: { x: 0.5, y: 0.8 }, lightAnchor: { x: 0.5, y: 0.1 }, floorLine: 0.95, ...(name === 'fx-boss.webp' ? { doorRect: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 } } : {}) };
  if (name.startsWith('desk')) return { surfaceY: 0.7, screenRect: { x: 0.2, y: 0.1, w: 0.5, h: 0.4 }, plateRect: { x: 0.3, y: 0.8, w: 0.4, h: 0.1 }, lampAnchor: { x: 0.9, y: 0.3 }, callAnchor: { x: 0.5, y: 0.2 } };
  return {};
};
export const goodTokens = (): Record<string, string> => ({ '--bg': '#fbf7ef', '--ink': '#222222' });

export interface Files { [name: string]: Buffer }
/** All parts of a complete world, pictures and manifest. `manifest` overrides fields (undefined removes one). */
export function goodPack(manifest: Record<string, unknown> = {}, only?: string[]): Files {
  const files: Files = {};
  for (const p of PART_TABLE) {
    if (only && !only.includes(p.name)) continue;
    const [w, h] = DIMS[p.name] || [100, 200];
    files[p.name] = webp(w, h);
  }
  const parts: Record<string, unknown> = {};
  for (const n of Object.keys(files)) parts[n] = { anchors: goodAnchors(n) };
  const m: Record<string, unknown> = { formatVersion: 1, id: 'test-world', name: 'Test world', version: 1, defaultSet: 'office', tokens: goodTokens(), lights: { lamp: 'flame', call: 'dot' }, rideStyle: 'doors', parts, description: 'A synthetic world for tests.', licence: 'CC0', ...manifest };
  for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
  files['world.json'] = Buffer.from(JSON.stringify(m));
  return files;
}
export const toStored = (f: Files): Buffer => writeStoredZip(Object.keys(f).map((name) => ({ name, data: f[name] })));

// ---- raw zips: every field of the format open to abuse ----
export interface RawEntry {
  name: string | Buffer; data?: Buffer; method?: number; flags?: number; attr?: number; made?: number;
  cextra?: Buffer; lextra?: Buffer; lname?: Buffer; lflags?: number; lmethod?: number;
  /** what the directory claims (default: the real values) */ size?: number; csize?: number; crc?: number;
  /** what the local header claims */ lsize?: number; lcsize?: number; lcrc?: number;
  /** raw (already compressed) bytes in place of the data */ packed?: Buffer;
  descriptor?: 'sig' | 'nosig' | 'none'; /** the descriptor's own values, when they should differ from the directory */ ddata?: [number, number, number]; offset?: number; diskStart?: number;
}
export interface RawOpts { prefix?: Buffer; suffix?: Buffer; comment?: Buffer; eocd?: { commentLen?: number; total?: number; disk?: number; cdDisk?: number; onDisk?: number; cdSize?: number; cdOff?: number }; locator?: boolean; gapAfterFirst?: Buffer; gapAfterLast?: Buffer; shiftOffsets?: boolean }
export function rawZip(entries: RawEntry[], o: RawOpts = {}): Buffer {
  const prefix = o.prefix || Buffer.alloc(0);
  const parts: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  entries.forEach((e, i) => {
    const name = Buffer.isBuffer(e.name) ? e.name : Buffer.from(e.name, 'latin1');
    const data = e.data || Buffer.alloc(0);
    const method = e.method ?? 0;
    const packed = e.packed ?? (method === 8 ? zlib.deflateRawSync(data) : data);
    const crc = e.crc ?? crc32(data), size = e.size ?? data.length, csize = e.csize ?? packed.length;
    const flags = e.flags ?? (e.descriptor ? 0x0008 : 0);
    const lh = Buffer.concat([le32(0x04034b50), le16(20), le16(e.lflags ?? flags), le16(e.lmethod ?? method), le16(0), le16(0x21),
      le32(e.descriptor ? (e.lcrc ?? 0) : (e.lcrc ?? crc)), le32(e.descriptor ? (e.lcsize ?? 0) : (e.lcsize ?? csize)), le32(e.descriptor ? (e.lsize ?? 0) : (e.lsize ?? size)),
      le16((e.lname || name).length), le16((e.lextra || Buffer.alloc(0)).length), e.lname || name, e.lextra || Buffer.alloc(0)]);
    const here = e.offset ?? off;
    const ch = Buffer.concat([le32(0x02014b50), le16(e.made ?? ((3 << 8) | 20)), le16(20), le16(flags), le16(method), le16(0), le16(0x21), le32(crc), le32(csize), le32(size),
      le16(name.length), le16((e.cextra || Buffer.alloc(0)).length), le16(0), le16(e.diskStart ?? 0), le16(0), le32(e.attr ?? ((0o100644 << 16) >>> 0)), le32(here + (o.shiftOffsets ? prefix.length : 0)), name, e.cextra || Buffer.alloc(0)]);
    parts.push(lh, packed);
    let len = lh.length + packed.length;
    const dd = e.ddata || [crc, csize, size];
    if (e.descriptor === 'sig') { parts.push(le32(0x08074b50), le32(dd[0]), le32(dd[1]), le32(dd[2])); len += 16; }
    if (e.descriptor === 'nosig') { parts.push(le32(dd[0]), le32(dd[1]), le32(dd[2])); len += 12; }
    if (i === 0 && o.gapAfterFirst) { parts.push(o.gapAfterFirst); len += o.gapAfterFirst.length; }
    if (i === entries.length - 1 && o.gapAfterLast) { parts.push(o.gapAfterLast); len += o.gapAfterLast.length; }
    off += len;
    central.push(ch);
  });
  const cd = Buffer.concat(central);
  const x = o.eocd || {};
  const eocd = Buffer.concat([le32(0x06054b50), le16(x.disk ?? 0), le16(x.cdDisk ?? 0), le16(x.onDisk ?? entries.length), le16(x.total ?? entries.length), le32(x.cdSize ?? cd.length), le32(x.cdOff ?? (off + (o.shiftOffsets ? prefix.length : 0))), le16(x.commentLen ?? (o.comment || Buffer.alloc(0)).length), o.comment || Buffer.alloc(0)]);
  const loc = o.locator ? Buffer.concat([le32(0x07064b50), le32(0), le32(0), le32(0), le32(1)]) : Buffer.alloc(0);
  return Buffer.concat([prefix, ...parts, cd, loc, eocd, o.suffix || Buffer.alloc(0)]);
}
/** The entries of a pack as raw entries (stored). */
export const rawFrom = (f: Files): RawEntry[] => Object.keys(f).map((name) => ({ name, data: f[name] }));

// ---- the hostile set: each must be refused ----
export interface Hostile { id: string; zip: Buffer }
const MARK = 'ZZSECRETZZ';
export function hostileSet(): Hostile[] {
  const out: Hostile[] = [];
  const add = (id: string, zip: Buffer): void => { out.push({ id, zip }); };
  const good = goodPack();
  const withName = (orig: string, name: string | Buffer): Buffer => { const es = rawFrom(good); es[es.findIndex((e) => e.name === orig)].name = name; return rawZip(es); };
  const plus = (extra: RawEntry): Buffer => rawZip([...rawFrom(good), extra]);
  const one = (name: string | Buffer, data = Buffer.from('x')): Buffer => rawZip([...rawFrom(good), { name, data }]);
  // names (FR-051)
  add('traversal', one('../evil.webp'));
  add('traversal-deep', one('a/../../evil.webp'));
  add('backslash-traversal', one('..\\evil.webp'));
  add('backslash', one('dir\\wall.webp'));
  add('absolute', one('/etc/passwd'));
  add('absolute-windows', one('/C:/x.webp'));
  add('drive-letter', one('C:/x.webp'));
  add('drive-relative', one('C:x.webp'));
  add('colon-stream', one('wall.webp:Zone.Identifier'));
  add('nul-in-name', one(Buffer.from('wall\0.webp')));
  add('control-char', one(Buffer.from('wall\x07.webp')));
  add('bidi-name', plus({ name: Buffer.from('wall\u202etxt.webp', 'utf8'), data: Buffer.from('x'), flags: 0x0800 }));
  add('unicode-lookalike', plus({ name: Buffer.from('\uff57all.webp', 'utf8'), data: Buffer.from('x'), flags: 0x0800 }));
  add('reserved-con', one('con.webp'));
  add('reserved-nul', one('NUL'));
  add('reserved-com1', one('com1.txt'));
  add('trailing-dot', one('wall2.webp.'));
  add('trailing-space', one('wall2.webp '));
  add('case-duplicate', plus({ name: 'WALL.webp', data: webp(600, 200) }));
  add('exact-duplicate', plus({ name: 'wall.webp', data: webp(600, 200) }));
  add('nested-folder', one('a/b/c.webp'));
  add('two-top-folders', rawZip([{ name: 'one/world.json', data: good['world.json'] }, { name: 'two/wall.webp', data: good['wall.webp'] }]));
  add('mixed-root-and-folder', rawZip([{ name: 'one/world.json', data: good['world.json'] }, { name: 'wall.webp', data: good['wall.webp'] }]));
  add('macosx-traversal', one('__MACOSX/../x'));
  add('dsstore-folder', one('.DS_Store/x'));
  add('dot-folder', one('.hidden/world.json'));
  add('name-too-long', one('a'.repeat(65) + '.webp'));
  add('empty-name', one(''));
  add('not-on-list-readme', one('README.txt'));
  add('not-on-list-js', one('evil.js', Buffer.from('alert(1)')));
  add('not-on-list-html', one('index.html', Buffer.from('<script>alert(1)</script>')));
  add('not-on-list-svg', one('wall.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')));
  add('not-on-list-exe', one('run.exe', Buffer.from('MZ')));
  add('secret-marker-name', one(MARK + '.bin'));
  // zip structure
  add('symlink-attr', plus({ name: 'link', data: Buffer.from('/etc/passwd'), attr: (0o120777 << 16) >>> 0 }));
  add('device-attr', plus({ name: 'dev', data: Buffer.alloc(0), attr: (0o020666 << 16) >>> 0 }));
  add('dos-reparse-attr', plus({ name: 'rp', data: Buffer.alloc(0), made: 20, attr: 0x400 }));
  add('encrypted', plus({ name: 'secret.bin', data: Buffer.from('x'), flags: 0x0001 }));
  add('strong-encryption', plus({ name: 'secret.bin', data: Buffer.from('x'), flags: 0x0041 }));
  add('masked-header', plus({ name: 'secret.bin', data: Buffer.from('x'), flags: 0x2000 }));
  add('method-bzip2', plus({ name: 'a.bin', data: Buffer.from('x'), method: 12 }));
  add('method-deflate64', plus({ name: 'a.bin', data: Buffer.from('x'), method: 9 }));
  add('zip64-locator', rawZip(rawFrom(good), { locator: true }));
  add('zip64-extra', plus({ name: 'a.bin', data: Buffer.from('x'), cextra: Buffer.concat([le16(1), le16(8), Buffer.alloc(8)]) }));
  add('zip64-local-extra', plus({ name: 'a.bin', data: Buffer.from('x'), lextra: Buffer.concat([le16(1), le16(8), Buffer.alloc(8)]) }));
  add('zip64-sentinel-size', plus({ name: 'a.bin', data: Buffer.from('x'), size: 0xffffffff }));
  add('zip64-sentinel-entries', rawZip(rawFrom(good), { eocd: { total: 0xffff, onDisk: 0xffff } }));
  add('multi-disk-eocd', rawZip(rawFrom(good), { eocd: { disk: 1 } }));
  add('multi-disk-entry', plus({ name: 'a.bin', data: Buffer.from('x'), diskStart: 1 }));
  add('extra-field-damaged', plus({ name: 'a.bin', data: Buffer.from('x'), cextra: Buffer.from([0x55, 0x54, 0xff, 0xff, 1]) }));
  add('eocd-count-mismatch', rawZip(rawFrom(good), { eocd: { onDisk: 3 } }));
  add('eocd-total-lies', rawZip(rawFrom(good), { eocd: { total: Object.keys(good).length - 1, onDisk: Object.keys(good).length - 1 } }));
  add('cd-offset-lies', rawZip(rawFrom(good), { eocd: { cdOff: 5 } }));
  add('cd-size-lies', rawZip(rawFrom(good), { eocd: { cdSize: 3 } }));
  add('empty-zip', rawZip([]));
  add('zip-comment', rawZip(rawFrom(good), { comment: Buffer.from('hello') }));
  add('polyglot-suffix', rawZip(rawFrom(good), { suffix: Buffer.from('<script>alert(1)</script>') }));
  add('polyglot-prefix-png', rawZip(rawFrom(good), { prefix: png(10, 10), shiftOffsets: true }));
  add('polyglot-prefix-unshifted', rawZip(rawFrom(good), { prefix: Buffer.from('GIF89a') }));
  add('gap-between-entries', rawZip(rawFrom(good), { gapAfterFirst: Buffer.from('<?php system($_GET[0]); ?>') }));
  add('not-a-zip-text', Buffer.from('this is not a zip file at all, just some text '.repeat(10)));
  add('empty-buffer', Buffer.alloc(0));
  add('eocd-only-garbage', Buffer.concat([Buffer.alloc(100, 1), le32(0x06054b50), Buffer.alloc(18)]));
  add('zip-comment-length-lies', rawZip(rawFrom(good), { eocd: { commentLen: 5 } }));
  add('cd-signature-bad', (() => { const z = Buffer.from(toStored(good)); z[z.readUInt32LE(z.length - 6)] ^= 0xff; return z; })());
  add('local-signature-bad', (() => { const z = Buffer.from(toStored(good)); z[0] ^= 0xff; return z; })());
  add('cd-extra-too-long', plus({ name: 'a.bin', data: Buffer.from('x'), cextra: Buffer.concat([le16(0x5455), le16(1100), Buffer.alloc(1100)]) }));
  add('local-extra-too-long', plus({ name: 'a.bin', data: Buffer.from('x'), lextra: Buffer.concat([le16(0x5455), le16(1100), Buffer.alloc(1100)]) }));
  add('cd-extra-short-header', plus({ name: 'a.bin', data: Buffer.from('x'), cextra: Buffer.from([1, 2, 3]) }));
  add('macosx-deep-folder', rawZip([...rawFrom(good), { name: '__MACOSX/a/b/', data: Buffer.alloc(0) }]));
  add('hidden-folder-entry', rawZip([{ name: '.hidden/', data: Buffer.alloc(0) }, ...rawFrom(good)]));
  add('thumbs-folder-entry', rawZip([{ name: 'Thumbs.db/', data: Buffer.alloc(0) }, ...rawFrom(good)]));
  add('descriptor-values-differ', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { ...e, descriptor: 'sig' as const, ddata: [1, 2, 3] as [number, number, number] } : e))));
  add('descriptor-missing', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { ...e, descriptor: 'none' as const } : e))));
  add('gap-after-last-file', rawZip(rawFrom(good), { gapAfterLast: Buffer.from('<?php ?>') }));
  add('deflate-shorter-than-declared', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { name: e.name, data: Buffer.alloc(2000), method: 8, size: 3000 } : e))));
  add('deflate-empty-small', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { name: e.name, data: Buffer.alloc(2000), method: 8, packed: Buffer.alloc(0) } : e))));
  // local header and directory disagree
  add('local-name-differs', rawZip(rawFrom(good).map((e) => (e.name === 'slip.webp' ? { ...e, lname: Buffer.from('../x.webp') } : e))));
  add('local-size-differs', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { ...e, lsize: 5, lcsize: 5 } : e))));
  add('local-crc-differs', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { ...e, lcrc: 1 } : e))));
  add('local-method-differs', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { ...e, lmethod: 8 } : e))));
  add('local-flags-differ', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { ...e, lflags: 0x0800 } : e))));
  add('descriptor-disagrees', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { ...e, descriptor: 'sig' as const, lcrc: 99 } : e))));
  add('stored-sizes-differ', plus({ name: 'a.bin', data: Buffer.from('xyz'), csize: 2 }));
  add('crc-wrong', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { ...e, crc: 12345 } : e))));
  add('overlap-same-offset', rawZip(rawFrom(good).map((e) => (e.name === 'world.json' ? { ...e, offset: 0 } : e))));
  add('overlap-inside', rawZip(rawFrom(good).map((e) => (e.name === 'world.json' ? { ...e, offset: 40 } : e))));
  add('entry-past-end', rawZip(rawFrom(good).map((e) => (e.name === 'world.json' ? { ...e, csize: 1 << 20, size: 1 << 20 } : e))));
  add('offset-past-end', rawZip(rawFrom(good).map((e) => (e.name === 'world.json' ? { ...e, offset: 1 << 28 } : e))));
  add('folder-with-data', rawZip([{ name: 'dir/', data: Buffer.from('xx'), size: 2, csize: 2 }]));
  // sizes, bombs (FR-051)
  const zeros = (n: number): Buffer => Buffer.alloc(n);
  add('bomb-ratio', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { name: e.name, data: zeros(6 * 1024 * 1024), method: 8 } : e))));
  add('bomb-declared-small', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { name: e.name, data: zeros(3 * 1024 * 1024), method: 8, size: 4000 } : e))));
  add('bomb-over-entry-cap', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { name: e.name, data: zeros(21 * 1024 * 1024), method: 8 } : e))));
  add('claimed-huge-size', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { ...e, size: 0xfffffff0 } : e))));
  add('claimed-huge-csize', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { ...e, csize: 0xfffffff0 } : e))));
  add('deflate-garbage', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { name: e.name, data: zeros(5000), method: 8, packed: Buffer.alloc(200, 0xff) } : e))));
  add('deflate-empty-but-claims-data', rawZip(rawFrom(good).map((e) => (e.name === 'wall.webp' ? { name: e.name, data: zeros(5000), method: 8, packed: Buffer.alloc(0) } : e))));
  const many = Array.from({ length: 97 }, (_, i) => ({ name: 'f' + i + '.bin', data: Buffer.from('x') }));
  add('too-many-entries', rawZip(many));
  const forty1: Files = goodPack();
  for (let i = 0; i < 20; i++) forty1['extra-' + i + '.webp'] = webp(10, 10);
  add('too-many-files', toStored(forty1));
  // truncated: every cut of a good zip
  const whole = toStored(good);
  for (const frac of [0.99, 0.9, 0.5, 0.1]) add('truncated-' + frac, whole.subarray(0, Math.floor(whole.length * frac)));
  add('truncated-minus-one', whole.subarray(0, whole.length - 1));
  add('truncated-eocd-short', whole.subarray(0, whole.length - 10));
  // content: pictures (FR-052)
  const swap = (name: string, data: Buffer): Buffer => { const f = goodPack(); f[name] = data; return toStored(f); };
  add('svg-with-script-as-webp', swap('wall.webp', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>')));
  add('html-as-webp', swap('wall.webp', Buffer.from('<!doctype html><script>alert(1)</script>')));
  add('jpeg-as-webp', swap('wall.webp', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)])));
  add('gif-as-webp', swap('wall.webp', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(100)])));
  add('empty-picture', swap('wall.webp', Buffer.alloc(0)));
  add('png-magic-only', swap('wall.webp', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  add('riff-not-webp', swap('wall.webp', Buffer.concat([Buffer.from('RIFF'), le32(30), Buffer.from('WAVE'), Buffer.alloc(30)])));
  add('webp-truncated', swap('wall.webp', webp(600, 200, 200).subarray(0, 60)));
  add('webp-trailing-script', swap('wall.webp', Buffer.concat([webp(600, 200), Buffer.from('<script>alert(1)</script>')])));
  add('webp-metadata-chunk', swap('wall.webp', riff([vp8l(600, 200), chunk('EXIF', Buffer.from('<script>'))])));
  add('webp-animated-flag', swap('wall.webp', riff([vp8x(600, 200, 0x12), vp8l(600, 200)])));
  add('webp-animated-anmf', swap('wall.webp', riff([vp8x(600, 200, 0x12), chunk('ANIM', Buffer.alloc(6)), chunk('ANMF', Buffer.alloc(30))])));
  add('webp-canvas-vs-bitstream', swap('wall.webp', riff([vp8x(600, 200, 0x10), vp8l(300, 100)])));
  add('webp-no-picture-data', swap('wall.webp', riff([chunk('JUNK', Buffer.alloc(8))])));
  add('webp-two-picture-chunks', swap('wall.webp', riff([vp8l(600, 200), vp8l(600, 200)])));
  add('webp-vp8x-two-picture-chunks', swap('wall.webp', riff([vp8x(600, 200, 0x10), vp8l(600, 200), vp8l(600, 200)])));
  add('webp-simple-with-alph', swap('wall.webp', riff([vp8l(600, 200), chunk('ALPH', Buffer.alloc(8))])));
  add('webp-vp8x-only', swap('wall.webp', riff([vp8x(600, 200, 0x10)])));
  add('webp-vp8l-bad-signature', swap('wall.webp', (() => { const b = Buffer.from(webp(600, 200)); b[20] = 0x00; return b; })()));
  add('webp-vp8-bad-start-code', swap('wall.webp', (() => { const b = Buffer.from(riff([vp8(600, 200)])); b[23] = 0x00; return b; })()));
  add('png-zero-dims', swap('wall.webp', png(0, 0)));
  add('manifest-anchor-rect-extra-key', (() => { const m = JSON.parse(goodPack()['world.json'].toString()); m.parts['desk-half.webp'].anchors.screenRect = { x: 0.1, y: 0.1, w: 0.3, h: 0.3, z: 1 }; return toStored({ ...goodPack(), 'world.json': Buffer.from(JSON.stringify(m)) }); })());
  add('webp-huge-dims', swap('wall.webp', webp(16384, 16384)));
  add('png-animated', swap('wall.webp', png(600, 200, [pngChunk('acTL', Buffer.alloc(8))])));
  add('png-text-chunk', swap('wall.webp', png(600, 200, [pngChunk('tEXt', Buffer.from('Comment\0<script>'))])));
  add('png-no-iend', swap('wall.webp', png(600, 200, [], { iend: false })));
  add('png-trailing-zip', swap('wall.webp', png(600, 200, [], { trailing: whole })));
  add('png-bad-crc', swap('wall.webp', (() => { const b = png(600, 200); b[b.length - 20] ^= 0xff; return b; })()));
  add('png-huge-chunk-len', swap('wall.webp', (() => { const b = png(600, 200); b.writeUInt32BE(0xfffffff0, 33); return b; })()));
  add('too-tall-fixture', swap('fx-library.webp', webp(100, 301)));
  add('too-wide-picture', swap('wall.webp', webp(4097, 100)));
  add('welcome-over-1920', swap('welcome.webp', webp(1921, 1000)));
  add('window-too-narrow', swap('window-1.webp', webp(10, 200)));
  add('over-byte-cap', swap('fx-library.webp', webpOfSize(100, 200, 121 * 1024)));
  add('over-byte-cap-lift-frame', swap('slip.webp', webpOfSize(300, 100, 25 * 1024)));
  add('lift-shaft-too-wide', swap('lift-shaft.webp', webp(181, 400)));
  // manifest (FR-040)
  const man = (m: Record<string, unknown>): Buffer => toStored(goodPack(m));
  add('manifest-unknown-field', man({ scripts: 'alert(1)' }));
  add('manifest-proto', toStored({ ...goodPack(), 'world.json': Buffer.from(JSON.stringify(JSON.parse('{"__proto__":{"polluted":true},"formatVersion":1}'))) }));
  add('manifest-proto-field', (() => { const f = goodPack(); f['world.json'] = Buffer.from(f['world.json'].toString().replace('{', '{"__proto__":{"x":1},')); return toStored(f); })());
  add('manifest-realheight', man({ realHeight: 2.1 }));
  add('manifest-position-field', man({ x: 10, y: 20 }));
  add('manifest-newer-format', man({ formatVersion: 2 }));
  add('manifest-format-zero', man({ formatVersion: 0 }));
  add('manifest-format-string', man({ formatVersion: '1' }));
  add('manifest-no-id', man({ id: undefined }));
  add('manifest-bad-id', man({ id: '../x' }));
  add('manifest-long-name', man({ name: 'x'.repeat(41) }));
  add('manifest-empty-name', man({ name: '' }));
  add('manifest-bidi-name', man({ name: 'Nice\u202eevil' }));
  add('manifest-control-name', man({ name: 'a\u0007b' }));
  add('manifest-markup-name', man({ name: '<img src=x onerror=1>' }));
  add('manifest-backtick-description', man({ description: 'run `rm -rf`' }));
  add('manifest-long-description', man({ description: 'd'.repeat(201) }));
  add('manifest-long-licence', man({ licence: 'l'.repeat(41) }));
  add('manifest-version-fraction', man({ version: 1.5 }));
  add('manifest-version-huge', man({ version: 1e12 }));
  add('manifest-version-negative', man({ version: -1 }));
  add('manifest-bad-defaultset', man({ defaultSet: 'A B' }));
  add('manifest-bad-lamp', man({ lights: { lamp: 'laser' } }));
  add('manifest-light-colour', man({ lights: { lamp: 'flame', colour: '#fff' } }));
  add('manifest-bad-ride', man({ rideStyle: 'teleport' }));
  add('manifest-token-url', man({ tokens: { '--bg': 'url(https://evil.example/x.png)' } }));
  add('manifest-token-markup', man({ tokens: { '--bg': '<script>' } }));
  add('manifest-token-css-syntax', man({ tokens: { '--bg': '#fff;} body{display:none' } }));
  add('manifest-token-bad-key', man({ tokens: { 'background': '#fff' } }));
  add('manifest-token-unknown-font', man({ tokens: { '--font': '"Totally Unknown Font"' } }));
  add('manifest-token-font-url', man({ tokens: { '--font': 'url(x)' } }));
  add('manifest-tokens-not-object', man({ tokens: ['--bg'] }));
  add('manifest-too-many-tokens', man({ tokens: Object.fromEntries(Array.from({ length: 300 }, (_, i) => ['--t' + i, '#fff'])) }));
  add('manifest-parts-missing', man({ parts: undefined }));
  add('manifest-part-not-on-list', man({ parts: { 'evil.js': {} } }));
  add('manifest-part-not-in-pack', (() => { const f = goodPack(); delete f['window-2.webp']; return toStored(f); })());
  add('manifest-part-unlisted', (() => { const m = JSON.parse(goodPack()['world.json'].toString()); delete m.parts['slip.webp']; return toStored({ ...goodPack(), 'world.json': Buffer.from(JSON.stringify(m)) }); })());
  add('manifest-part-field', man({ parts: { 'wall.webp': { anchors: {}, src: 'http://x' } } }));
  add('manifest-anchor-out-of-range', (() => { const m = JSON.parse(goodPack()['world.json'].toString()); m.parts['fx-library.webp'].anchors.standX = 1.5; return toStored({ ...goodPack(), 'world.json': Buffer.from(JSON.stringify(m)) }); })());
  add('manifest-anchor-negative', (() => { const m = JSON.parse(goodPack()['world.json'].toString()); m.parts['fx-library.webp'].anchors.floorLine = -0.1; return toStored({ ...goodPack(), 'world.json': Buffer.from(JSON.stringify(m)) }); })());
  add('manifest-anchor-unknown', (() => { const m = JSON.parse(goodPack()['world.json'].toString()); m.parts['fx-library.webp'].anchors.doorRect = { x: 0, y: 0, w: 1, h: 1 }; return toStored({ ...goodPack(), 'world.json': Buffer.from(JSON.stringify(m)) }); })());
  add('manifest-anchor-string', (() => { const m = JSON.parse(goodPack()['world.json'].toString()); m.parts['fx-library.webp'].anchors.standX = '0.5'; return toStored({ ...goodPack(), 'world.json': Buffer.from(JSON.stringify(m)) }); })());
  add('manifest-anchor-rect-overflow', (() => { const m = JSON.parse(goodPack()['world.json'].toString()); m.parts['desk-half.webp'].anchors.screenRect = { x: 0.6, y: 0.1, w: 0.6, h: 0.4 }; return toStored({ ...goodPack(), 'world.json': Buffer.from(JSON.stringify(m)) }); })());
  add('manifest-anchor-extra-key', (() => { const m = JSON.parse(goodPack()['world.json'].toString()); m.parts['desk-half.webp'].anchors.callAnchor = { x: 0.1, y: 0.1, z: 3 }; return toStored({ ...goodPack(), 'world.json': Buffer.from(JSON.stringify(m)) }); })());
  add('manifest-screen-too-small', (() => { const m = JSON.parse(goodPack()['world.json'].toString()); m.parts['desk-half.webp'].anchors.screenRect = { x: 0.1, y: 0.1, w: 0.05, h: 0.05 }; return toStored({ ...goodPack(), 'world.json': Buffer.from(JSON.stringify(m)) }); })());
  add('manifest-hash-wrong', (() => { const m = JSON.parse(goodPack()['world.json'].toString()); m.parts['wall.webp'].sha256 = 'a'.repeat(64); return toStored({ ...goodPack(), 'world.json': Buffer.from(JSON.stringify(m)) }); })());
  add('manifest-hash-malformed', (() => { const m = JSON.parse(goodPack()['world.json'].toString()); m.parts['wall.webp'].sha256 = 'XYZ'; return toStored({ ...goodPack(), 'world.json': Buffer.from(JSON.stringify(m)) }); })());
  add('manifest-bytes-wrong', (() => { const m = JSON.parse(goodPack()['world.json'].toString()); m.parts['wall.webp'].bytes = 7; return toStored({ ...goodPack(), 'world.json': Buffer.from(JSON.stringify(m)) }); })());
  const mf = (b: Buffer): Buffer => toStored({ ...goodPack(), 'world.json': b });
  add('manifest-not-json', mf(Buffer.from('{not json')));
  add('manifest-array', mf(Buffer.from('[]')));
  add('manifest-null', mf(Buffer.from('null')));
  add('manifest-bom', mf(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), goodPack()['world.json']])));
  add('manifest-invalid-utf8', mf(Buffer.concat([Buffer.from('{"formatVersion":1,"name":"'), Buffer.from([0xff, 0xfe]), Buffer.from('"}')])));
  add('manifest-too-big', mf(Buffer.from(JSON.stringify({ ...JSON.parse(goodPack()['world.json'].toString()), description: 'x'.repeat(70000) }))));
  add('manifest-deep-nesting', mf(Buffer.from('['.repeat(30000) + ']'.repeat(30000))));
  add('manifest-missing', (() => { const f = goodPack(); delete f['world.json']; return toStored(f); })());
  return out;
}
export const SECRET_MARKER = MARK;
