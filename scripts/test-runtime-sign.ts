/**
 * Spec 058 FR-160 (issue #623): the packed mac app keeps GitHub's signature on the Copilot runtime, so the macOS keychain sees
 * GitHub's `copilot` (team VEKTX9H2N7) instead of a new ad-hoc program per build. Checks `scripts/check-runtime-signature.js` on
 * synthetic Mach-O files (no `codesign`, runs on every OS) and the `mac.signIgnore` / mac package scripts in package.json.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chk = require(path.join(root, 'scripts', 'check-runtime-signature.js')) as {
  GITHUB_TEAM_ID: string;
  parseSignatures(buf: Buffer): Array<{ signed?: boolean; adhoc?: boolean; identifier?: string; teamId?: string; error?: string }>;
  isMachO(buf: Buffer): boolean;
  problemOf(file: string, buf: Buffer): string | undefined;
  findRuntimeFiles(releaseDir: string, productName: string): string[];
  checkFiles(files: string[]): string[];
};

/** A minimal thin 64-bit Mach-O: header, one LC_CODE_SIGNATURE (or none), and an embedded signature with one CodeDirectory. */
function macho(sig?: { flags: number; identifier: string; teamId?: string; version?: number }): Buffer {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4); // arm64
  header.writeUInt32LE(sig ? 1 : 0, 16); // ncmds
  header.writeUInt32LE(sig ? 16 : 0, 20);
  if (!sig) return header;
  const version = sig.version ?? 0x20400;
  const ident = Buffer.from(sig.identifier + '\0');
  const team = sig.teamId !== undefined ? Buffer.from(sig.teamId + '\0') : Buffer.alloc(0);
  const cdFixed = 88;
  const cd = Buffer.alloc(cdFixed + ident.length + team.length);
  cd.writeUInt32BE(0xfade0c02, 0);
  cd.writeUInt32BE(cd.length, 4);
  cd.writeUInt32BE(version, 8);
  cd.writeUInt32BE(sig.flags, 12);
  cd.writeUInt32BE(cdFixed, 20); // identOffset
  ident.copy(cd, cdFixed);
  if (team.length) { cd.writeUInt32BE(cdFixed + ident.length, 48); team.copy(cd, cdFixed + ident.length); }
  const sb = Buffer.alloc(20 + cd.length);
  sb.writeUInt32BE(0xfade0cc0, 0);
  sb.writeUInt32BE(sb.length, 4);
  sb.writeUInt32BE(1, 8);
  sb.writeUInt32BE(0, 12); // CSSLOT_CODEDIRECTORY
  sb.writeUInt32BE(20, 16);
  cd.copy(sb, 20);
  const lc = Buffer.alloc(16);
  lc.writeUInt32LE(0x1d, 0);
  lc.writeUInt32LE(16, 4);
  lc.writeUInt32LE(48, 8); // signature right after header + load command
  lc.writeUInt32LE(sb.length, 12);
  return Buffer.concat([header, lc, sb]);
}

/** A universal (fat) file of the given slices. */
function fat(slices: Buffer[]): Buffer {
  const head = Buffer.alloc(8 + 20 * slices.length);
  head.writeUInt32BE(0xcafebabe, 0);
  head.writeUInt32BE(slices.length, 4);
  let at = head.length;
  slices.forEach((s, i) => {
    head.writeUInt32BE(at, 8 + i * 20 + 8);
    head.writeUInt32BE(s.length, 8 + i * 20 + 12);
    at += s.length;
  });
  return Buffer.concat([head, ...slices]);
}

const TEAM = chk.GITHUB_TEAM_ID;
const github = (identifier = 'copilot') => macho({ flags: 0x10000, identifier, teamId: TEAM });
const adhoc = macho({ flags: 0x2, identifier: 'copilot-runtime' });

// ---- parser
assert.strictEqual(TEAM, 'VEKTX9H2N7', "GitHub's Developer ID team (read: the darwin npm packages' signatures)");
assert.deepStrictEqual(chk.parseSignatures(github()), [{ signed: true, adhoc: false, identifier: 'copilot', teamId: TEAM }]);
assert.deepStrictEqual(chk.parseSignatures(adhoc), [{ signed: true, adhoc: true, identifier: 'copilot-runtime', teamId: '' }]);
assert.deepStrictEqual(chk.parseSignatures(macho()), [{ signed: false }], 'no LC_CODE_SIGNATURE = unsigned');
assert.strictEqual(chk.parseSignatures(macho({ flags: 0x20002, identifier: 'x' }))[0].adhoc, true, 'linker-signed counts as ad-hoc');
assert.strictEqual(chk.parseSignatures(macho({ flags: 0, identifier: 'x', teamId: TEAM, version: 0x20100 }))[0].teamId, '', 'an old code directory has no team field');
assert.ok(chk.parseSignatures(Buffer.from('#!/bin/sh\necho hi\n'))[0].error, 'not a Mach-O');
assert.ok(chk.parseSignatures(github().subarray(0, 60))[0].error, 'truncated signature');
assert.strictEqual(chk.parseSignatures(fat([github(), github()])).length, 2, 'universal: one result per slice');

// ---- verdicts
assert.strictEqual(chk.problemOf('/x/copilot-runtime', github()), undefined, "GitHub's own signature passes");
assert.strictEqual(chk.problemOf('/x/runtime.node', github('runtime')), undefined, 'other runtime files: any identifier, GitHub team');
assert.match(chk.problemOf('/x/copilot-runtime', adhoc)!, /ad-hoc.*signIgnore/, 'an ad-hoc re-sign (the old packaging) fails');
assert.match(chk.problemOf('/x/copilot-runtime', macho())!, /not signed/);
assert.match(chk.problemOf('/x/copilot-runtime', macho({ flags: 0x10000, identifier: 'copilot', teamId: 'ABCDE12345' }))!, /team "ABCDE12345"/);
assert.match(chk.problemOf('/x/copilot-runtime', github('copilot-runtime'))!, /identifier "copilot-runtime"/, 'the runtime must keep the CLI identifier');
assert.match(chk.problemOf('/x/copilot-runtime', fat([github(), adhoc]))!, /ad-hoc/, 'one bad slice fails a universal file');
assert.strictEqual(chk.isMachO(github()) && chk.isMachO(fat([github()])) && !chk.isMachO(Buffer.from('{}')), true);

// ---- files: the packed tree under release/, non-Mach-O skipped, the runtime required
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-runtimesign-'));
try {
  const put = (rel: string, data: Buffer) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return f; };
  const base = (mac: string, plat: string) =>
    path.join(mac, 'Agent Durbar.app', 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', '@github', `copilot-sdk-${plat}`, 'prebuilds', plat);
  const r1 = put(path.join(base('mac-arm64', 'darwin-arm64'), 'copilot-runtime'), github());
  const r2 = put(path.join(base('mac-arm64', 'darwin-arm64'), 'runtime.node'), github('runtime'));
  const r3 = put(path.join(base('mac', 'darwin-x64'), 'copilot-runtime'), github());
  put(path.join('linux-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', '@github', 'copilot-sdk-linux-x64', 'prebuilds', 'linux-x64', 'copilot-runtime'), Buffer.from('ELF'));
  put(path.join('mac-arm64', 'Agent Durbar.app', 'Contents', 'MacOS', 'Agent Durbar'), adhoc);
  const found = chk.findRuntimeFiles(tmp, 'Agent Durbar');
  assert.deepStrictEqual(found.sort(), [r3, r1, r2].sort(), 'only the darwin runtime files of each mac build');
  assert.deepStrictEqual(chk.findRuntimeFiles(path.join(tmp, 'missing'), 'Agent Durbar'), []);
  assert.deepStrictEqual(chk.checkFiles(found), [], 'all GitHub-signed: no problem');
  const txt = put('notes/readme.txt', Buffer.from('hello'));
  assert.deepStrictEqual(chk.checkFiles([...found, txt]), [], 'a non-Mach-O file is skipped');
  assert.deepStrictEqual(chk.checkFiles([txt]), ['no Mach-O runtime file found']);
  assert.deepStrictEqual(chk.checkFiles([r2]), ['copilot-runtime not found among the checked files']);
  fs.writeFileSync(r1, adhoc);
  assert.strictEqual(chk.checkFiles(found).length, 1, 'a re-signed runtime is reported');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- package.json: electron-builder skips exactly the darwin runtime files, and the mac package builds run the check
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string>; build: { mac: { signIgnore?: string[]; identity?: string } } };
const ignore = (pkg.build.mac.signIgnore ?? []).map((s) => new RegExp(s)); // as electron-builder's MacTargetHelper: new RegExp(it).test(file)
const skipped = (f: string) => ignore.some((re) => re.test(f));
const app = '/Users/me/build/release/mac-arm64/Agent Durbar.app';
for (const plat of ['darwin-arm64', 'darwin-x64']) {
  for (const f of ['copilot-runtime', 'runtime.node', `libmsalruntime_${plat.split('-')[1]}.dylib`, 'msal-node-runtime.node']) {
    assert.ok(skipped(`${app}/Contents/Resources/app.asar.unpacked/node_modules/@github/copilot-sdk-${plat}/prebuilds/${plat}/${f}`), `${plat}/${f} keeps GitHub's signature`);
  }
}
for (const f of [
  `${app}/Contents/MacOS/Agent Durbar`,
  `${app}/Contents/Frameworks/Electron Framework.framework`,
  `${app}/Contents/Frameworks/Agent Durbar Helper.app`,
  `${app}/Contents/Resources/app.asar.unpacked/node_modules/koffi/build/koffi/darwin_arm64/koffi.node`,
  `${app}/Contents/Resources/app.asar.unpacked/node_modules/@github/copilot-sdk/dist/index.js`,
  `${app}/Contents/Resources/app.asar`,
  app,
]) assert.ok(!skipped(f), `still signed by electron-builder: ${f}`);
assert.strictEqual(pkg.build.mac.identity, '-', 'ad-hoc builds (signing with a Developer ID is spec 014, needs the owner)');
for (const s of ['dist:mac:arm64', 'dist:mac:x64']) assert.match(pkg.scripts[s], /electron-builder[^&]*&&.*node scripts\/check-runtime-signature\.js/, `${s} runs the signature check after packing`);

console.log('runtime signature (spec 058 FR-160): all checks passed');
