/* Spec 102 T285/T286 (FR-035, FR-085, FR-170, FR-269 (b) and (g); issue #1402): the reproducible world packer, the reader for 097 T156..T159's ticks,
   and the availability gates. Pure Node, no Electron, no network. Used by scripts/test-world-pack.js now, and meant to be called by
   scripts/test-world-catalogue.js later (packWorld, readTicks, availabilityGate).

   packWorld(dir): the files of one world folder as one stored zip. The same files give the same bytes, on any OS and checkout:
     entries sorted by name (code units), the zip writer's fixed 1980-01-01 stamp, mode 0644, no extra fields, no comment (src/shared/worldzip.ts
     `writeStoredZip`, not a second writer); text files (.json .md .css .txt .svg) have \r\n turned into \n BEFORE hashing and zipping, so a CRLF
     checkout (Windows, core.autocrlf) packs to the same bytes; OS leftovers (.DS_Store, Thumbs.db, desktop.ini, ._*) and card.json (the card
     is not in the pack, FR-014) are left out; a folder, a link or anything not a plain file is refused, never followed.
   The manifest lists every entry with its bytes and sha256 and the sha256 of the whole zip.

   Needs `npx tsc -p tsconfig.scripts.json` first (dist-scripts), like scripts/make-world-fixtures.js. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIST = path.join(__dirname, '..', 'dist-scripts', 'src', 'shared');
const dist = (name) => {
  try { return require(path.join(DIST, name)); } catch (e) { throw new Error(`world-pack: ${name} is not built (run npx tsc -p tsconfig.scripts.json first): ${e.code || e.name}`); }
};

const TEXT_EXT = new Set(['.json', '.md', '.css', '.txt', '.svg']);
const OS_JUNK = /^(\.ds_store|thumbs\.db|desktop\.ini|\._.*)$/i;
const NOT_IN_PACK = new Set(['card.json']);
/** The 097 tasks the gate waits for (FR-035 (a)). */
const REQUIRED_TICKS = ['T156', 'T157', 'T158', 'T159'];

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Text with \r\n as \n, as bytes. Only a CR directly before an LF goes: a lone CR is content. */
function normaliseText(buf) { return Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1'); }

/** The files of a world folder, as the pack holds them: sorted, text normalised. Throws on a folder, a link or a non-regular file. */
function readPackFiles(dir) {
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    if (OS_JUNK.test(name) || NOT_IN_PACK.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (!st.isFile()) throw new Error(`world-pack: ${name} is not a plain file (folders and links are refused)`);
    const raw = fs.readFileSync(full);
    files.push({ name, data: TEXT_EXT.has(path.extname(name).toLowerCase()) ? normaliseText(raw) : raw });
  }
  return files.sort(byName);
}

/** { zip, zipSha256, files, manifest } for a world folder. Same input, same bytes. */
function packWorld(dir) {
  const files = readPackFiles(dir);
  if (!files.length) throw new Error('world-pack: the folder has no files to pack');
  const zip = dist('worldzip.js').writeStoredZip(files);
  const zipSha256 = sha256(zip);
  return {
    zip, zipSha256, files,
    manifest: { formatVersion: 1, zipSha256, bytes: zip.length, files: files.map((f) => ({ name: f.name, bytes: f.data.length, sha256: sha256(f.data) })) },
  };
}

/** Which of the required tasks are ticked in a tasks.md: { ticks: {T156: bool, ...}, missing: [ids not ticked] }. Split on /\r?\n/; a task that is not found,
    a file that cannot be read, or one of two lines for the same task being unticked, counts as not met. */
function readTicks(tasksPath, ids = REQUIRED_TICKS) {
  let text = '';
  try { text = fs.readFileSync(tasksPath, 'utf8'); } catch { /* every task not met */ }
  const state = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*- \[([ xX])\] (T\d+)\b/.exec(line);
    if (!m || !ids.includes(m[2])) continue;
    const ticked = m[1] !== ' ';
    state[m[2]] = m[2] in state ? state[m[2]] && ticked : ticked;
  }
  const ticks = {};
  for (const id of ids) ticks[id] = state[id] === true;
  return { ticks, missing: ids.filter((id) => !ticks[id]) };
}

const PICTURE = /\.(webp|png)$/i;

/** FR-035's gates for one world that asks to be `available`. world: { id, dir, status, sha256 } (sha256 = what the catalogue says the pack is).
    ctx: { tasksPath, registry (docs/experience/world-moments.json, parsed), validateOpts (worldpack PackOptions), pack (default packWorld) }.
    Returns { ok, problems: [{ gate, message }] }. A world that is not asking for `available` has nothing to refuse. Every failed gate is listed. */
function availabilityGate(world, ctx) {
  const problems = [];
  const fail = (gate, message) => problems.push({ gate, message: `${world && world.id}: ${message}` });
  if (!world || world.status !== 'available') return { ok: true, problems };

  // (a) 097 T156..T159 ticked
  const { missing } = readTicks(ctx.tasksPath);
  if (missing.length) fail('ticks', `${missing.join(', ')} not ticked in specs/097-real-office/tasks.md (FR-035 a)`);

  // (c) the registry row is shippable
  const row = ctx.registry && ctx.registry.worlds && Object.prototype.hasOwnProperty.call(ctx.registry.worlds, world.id) ? ctx.registry.worlds[world.id] : null;
  if (!row || row.shippable !== true) fail('registry', 'the registry row is missing or not shippable (FR-035 c)');

  let files = null;
  try { files = readPackFiles(world.dir); } catch (e) { fail('pack', `the folder cannot be packed: ${e.message}`); }

  // the card (FR-014); its shape and its pair checks are test-world-catalogue.js's, not repeated here
  try {
    const card = JSON.parse(fs.readFileSync(path.join(world.dir, 'card.json'), 'utf8'));
    if (!card || card.id !== world.id) fail('card', 'card.json names another world');
  } catch { fail('card', 'card.json is missing or unreadable (FR-014, FR-035 g)'); }

  if (files) {
    // (e) provenance: ASSETS.md names every picture (FR-170)
    const assets = files.find((f) => f.name === 'ASSETS.md');
    if (!assets) fail('provenance', 'ASSETS.md is missing (FR-170, FR-035 e)');
    else {
      const text = assets.data.toString('utf8');
      for (const f of files) if (PICTURE.test(f.name) && !text.includes(f.name)) fail('provenance', `ASSETS.md does not list ${f.name} (FR-170)`);
    }

    // (b) the pack validator, the one the app uses (FR-031): refused, unfinished or a missing part all fail
    try {
      if (!ctx.validateOpts) throw new Error('no validator options');
      const r = dist('worldpack.js').validateWorldFiles(files.filter((f) => f.name !== 'ASSETS.md'), ctx.validateOpts);
      if (!r.ok) fail('pack-valid', `the pack is refused: ${r.reason} (FR-035 b)`);
      else if (r.unfinished.length) fail('pack-valid', `a picture is missing for: ${r.unfinished.join(', ')} (FR-035 b)`);
    } catch (e) { fail('pack-valid', `the pack could not be validated (${e.message})`); }

    // the pack is reproducible: two packs of the folder are the same bytes
    const pack = ctx.pack || packWorld;
    try {
      const a = pack(world.dir), b = pack(world.dir);
      if (!Buffer.from(a.zip).equals(Buffer.from(b.zip))) fail('reproducible', 'two packs of the same folder differ (FR-085)');
      // the catalogue's hash is the pack's hash
      else if (typeof world.sha256 !== 'string' || world.sha256 !== sha256(a.zip)) fail('hash', 'the catalogue sha256 is not the pack\'s (FR-085)');
    } catch (e) { fail('reproducible', `the pack cannot be made: ${e.message}`); }
  }
  return { ok: problems.length === 0, problems };
}

module.exports = { packWorld, readPackFiles, readTicks, availabilityGate, normaliseText, REQUIRED_TICKS };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node scripts/world-pack.js <world folder> [out.zip]'); process.exit(2); }
  const r = packWorld(path.resolve(dir));
  if (process.argv[3]) fs.writeFileSync(process.argv[3], r.zip);
  console.log(JSON.stringify(r.manifest, null, 2));
}
