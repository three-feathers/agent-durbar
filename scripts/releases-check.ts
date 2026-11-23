/**
 * Spec 118 T008 (FR-026): `npm run releases:check [-- --version X.Y.Z] [--ref <tag or commit>]`.
 *   no arguments           the working tree's releases.json is valid (run by `npm test`, test:releases-json)
 *   --version X.Y.Z        ... and has an entry for that version
 *   --ref R --version X    the same, on the file of commit or tag R (`git cat-file blob R:releases.json`), never the tree:
 *                          what release.yml's verify job runs on the tagged commit (T076)
 * Exit 0 ok, 1 with one line on stderr. The file's text is never printed. git runs with an argument array, no shell.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { decodeUtf8Strict, parseReleasesJson, MAX_RELEASES_JSON_BYTES } from '../src/shared/selfupdate';

const VERSION_RE = /^(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})$/;
/** A tag, branch or commit name: no option (`-`), no revision syntax (`:`, `..`, `@{`, `^`, `~`), no space. */
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

/** undefined when the text is a valid releases.json (and, with a version, has its entry); else what is wrong. */
export function checkReleases(text: string, version?: string): string | undefined {
  if (version !== undefined && !VERSION_RE.test(version)) return `releases:check: the version must be MAJOR.MINOR.PATCH (no v, no pre-release), got ${JSON.stringify(version.slice(0, 40))}`;
  const marks = parseReleasesJson(text);
  if (!marks) return 'releases:check: releases.json is not valid (schema in specs/118-self-update/spec.md FR-026)';
  if (version !== undefined && !marks.has(version)) return `releases:check: releases.json has no entry for ${version}; the version PR adds one (breaking, notes, action)`;
  return undefined;
}

/** What main() touches, injectable so a test can count the git calls (a refused ref must never reach git). */
export interface CheckDeps {
  git: (args: string[]) => Buffer;
  lstat: (file: string) => fs.Stats;
  read: (file: string) => Buffer;
  cwd: string;
}
const realDeps = (): CheckDeps => ({
  git: (args) => execFileSync('git', args, { maxBuffer: 2 * MAX_RELEASES_JSON_BYTES, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }),
  lstat: (f) => fs.lstatSync(f),
  read: (f) => fs.readFileSync(f),
  cwd: process.cwd(),
});

/** Spec 008 FR-119 delta 2026-11-23: only a test build (`X.Y.Z-test.M`) needs no `releases.json` entry; any other pre-release does. */
export const entryExempt = (version: string): boolean => /^\d{1,9}\.\d{1,9}\.\d{1,9}(?:-[0-9A-Za-z.-]+)?-test\.\d+$/.test(version);

export const REF_REFUSED = 'releases:check: --ref must be a tag, branch or commit name';
export const NOT_REGULAR = 'releases:check: releases.json is not a regular file within 256 KiB (a link or a folder is refused)';

export function main(argv: string[], deps: CheckDeps = realDeps()): string | undefined {
  let version: string | undefined;
  let ref: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const [k, v] = [argv[i], argv[i + 1]];
    if (v === undefined) return `releases:check: ${k} wants a value`;
    if ((k === '--version' && version !== undefined) || (k === '--ref' && ref !== undefined)) return `releases:check: ${k} is given twice`;
    if (k === '--version') version = v;
    else if (k === '--ref') ref = v;
    else return `releases:check: unknown argument ${JSON.stringify(k.slice(0, 40))}`;
  }
  let bytes: Buffer;
  if (ref !== undefined) {
    if (version === undefined) return 'releases:check: --ref needs --version';
    if (!REF_RE.test(ref) || ref.includes('..')) return REF_REFUSED;
    try { bytes = deps.git(['cat-file', 'blob', ref + ':releases.json']); } catch { return `releases:check: no releases.json at ${ref}`; }
  } else {
    const file = path.join(deps.cwd, 'releases.json');
    try {
      const st = deps.lstat(file); // lstat: a symlink is not followed, it is refused (fail closed)
      if (!st.isFile() || st.size > MAX_RELEASES_JSON_BYTES) return NOT_REGULAR;
      bytes = deps.read(file);
    } catch { return 'releases:check: no releases.json in this folder'; }
  }
  const text = decodeUtf8Strict(bytes);
  return text === undefined ? 'releases:check: releases.json is not UTF-8' : checkReleases(text, version);
}

if (require.main === module) {
  const err = main(process.argv.slice(2));
  if (err) { console.error(err); process.exitCode = 1; } else console.log('releases:check: ok');
}
