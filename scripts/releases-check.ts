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
import { parseReleasesJson, MAX_RELEASES_JSON_BYTES } from '../src/shared/selfupdate';

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

const utf8 = (b: Buffer): string | undefined => { try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return undefined; } };

function main(argv: string[]): string | undefined {
  let version: string | undefined;
  let ref: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const [k, v] = [argv[i], argv[i + 1]];
    if (v === undefined) return `releases:check: ${k} wants a value`;
    if (k === '--version' && version === undefined) version = v;
    else if (k === '--ref' && ref === undefined) ref = v;
    else return `releases:check: unknown argument ${JSON.stringify(k.slice(0, 40))}`;
  }
  let bytes: Buffer;
  if (ref !== undefined) {
    if (version === undefined) return 'releases:check: --ref needs --version';
    if (!REF_RE.test(ref) || ref.includes('..')) return 'releases:check: --ref must be a tag, branch or commit name';
    try {
      bytes = execFileSync('git', ['cat-file', 'blob', ref + ':releases.json'], { maxBuffer: 2 * MAX_RELEASES_JSON_BYTES, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    } catch { return `releases:check: no releases.json at ${ref}`; }
  } else {
    const file = path.join(process.cwd(), 'releases.json');
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile() || st.size > MAX_RELEASES_JSON_BYTES) return 'releases:check: releases.json is not a regular file within 256 KiB';
      bytes = fs.readFileSync(file);
    } catch { return 'releases:check: no releases.json in this folder'; }
  }
  const text = utf8(bytes);
  return text === undefined ? 'releases:check: releases.json is not UTF-8' : checkReleases(text, version);
}

if (require.main === module) {
  const err = main(process.argv.slice(2));
  if (err) { console.error(err); process.exitCode = 1; } else console.log('releases:check: ok');
}
