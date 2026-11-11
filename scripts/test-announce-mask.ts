/**
 * Spec 012 FR-178 (issue #1419): the screen-reader announcements (`announce()` in `src/renderer/app.js`, the polite live region
 * `#srAnnounce`) mask the whole line: home folders on the raw text, then the desk mask, then the 300-character cut. An agent or folder name
 * can hold a token-shaped string or a home folder, and many lines are built from one (`<name> finished. New reply.`).
 * The page's own definitions (`homeMask`, `helperMask`, `deskMask`, `SAFE`, `annHome`, `annPart`, `annMask`, `announce`) are cut out of app.js and run in a
 * sandbox with the compiled shared mask and safetext.js, so a change to the page's code is what is tested. Source checks keep every caller
 * on that one function. Fake tokens only, built at run time. `npm run test:announcemask`. No credits spent.
 */
import './safetext-shared';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import * as shared from '../src/shared/redact';

const R_DIR = path.join(__dirname, '..', '..', 'src', 'renderer');
const app = fs.readFileSync(path.join(R_DIR, 'app.js'), 'utf8');
let n = 0;
const ok = (c: unknown, m: string): void => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string): void => { assert.deepStrictEqual(a, b, m); n++; };

// one whole line of app.js that starts with `head` (each definition below is a single line)
const line = (head: string): string => {
  const lines = app.split('\n').filter((l) => l.startsWith(head));
  assert.strictEqual(lines.length, 1, `app.js has exactly one line starting with ${head}`);
  return lines[0];
};
const DEFS = ['const homeMask=', 'const helperMask=', 'const deskMask=', 'const SHORT=', 'const RED=', 'const STX=', 'const SAFE=',
  'const safeExcerpt=', 'let announceT=', 'const ANN_REQUEST=', 'const ANN_UNCHECKED=', 'function annHome(', 'function annPart(', 'function annMask(',
  'function announce('].map(line).join('\n');
const UNCHECKED = 'A line was not read out: Durbar could not check it for secrets.';

type Page = { say(text: unknown, prio?: number): string | null; queue(text: unknown, prio?: number): void; fire(): string | null; unchecked: string };
// a page with (or without) the redact module; `say` announces and runs the 60 ms timer, giving what the live region holds (null: untouched).
// `queue` announces without running the timer, `fire` runs it. 'throws': maskHomePaths throws; 'failed': it gives its own failure text
// ('[redaction failed]', what the shared module returns when it fails); 'noredact': the simulator's ?noredact=1 (the module loaded, RED off).
type Mode = boolean | 'throws' | 'failed' | 'noredact';
const page = (mode: Mode): Page => {
  const el: { textContent: string | null } = { textContent: null };
  let timer: (() => void) | null = null;
  const R = mode === 'throws' ? { ...shared, maskHomePaths: () => { throw new Error('boom'); } }
    : mode === 'failed' ? { ...shared, maskHomePaths: () => '[redaction failed]' } : mode ? shared : undefined;
  const ctx = vm.createContext({
    window: { DurbarRedact: R, DurbarSafeText: require(path.join(R_DIR, 'safetext.js')) },
    DurbarCutText: require(path.join(R_DIR, 'cuttext.js')),
    NO_REDACT: !mode || mode === 'noredact',
    $: (id: string) => (id === 'srAnnounce' ? el : null),
    setTimeout: (f: () => void) => { timer = f; return 1; },
    clearTimeout: () => { timer = null; },
  });
  vm.runInContext(DEFS + '\nthis.announce=announce;this.unchecked=ANN_UNCHECKED;', ctx);
  const C = ctx as unknown as { announce(t: unknown, p?: number): void; unchecked: string };
  const fire = (): string | null => { if (timer) (timer as () => void)(); timer = null; return el.textContent; };
  return {
    say(text, prio) { el.textContent = null; timer = null; C.announce(text, prio); return fire(); },
    queue(text, prio) { C.announce(text, prio); },
    fire,
    unchecked: C.unchecked,
  };
};

// fake secrets, never real ones
const GHP = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const SK = 's' + 'k-' + 'proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const USER = 'zqxuser' + 'name';
const NAMES: [string, string][] = [
  ['a GitHub token', 'fix ' + GHP],
  ['an OpenAI key', 'agent ' + SK],
  ['a Linux home folder', '/home/' + USER + '/repo'],
  ['a macOS home folder', '/Users/' + USER + '/repo'],
  ['a Windows home folder', 'C:\\Users\\' + USER + '\\repo'],
  ['a UNC home folder', '\\\\host\\share\\' + USER + '\\repo'],
  ['a Markdown-escaped token', 'ghp\\_' + GHP.slice(4)],
  // hidden characters inside a home folder (review of PR 1484): the home mask also reads the copy without them
  ['a Linux home folder with a zero-width space in "home"', '/ho\u200bme/' + USER + '/repo'],
  ['a Linux home folder with a zero-width space after "home"', '/home\u200b/' + USER + '/repo'],
  ['a macOS home folder with a soft hyphen in the user name', '/Users/zqx\u00aduser' + 'name/repo'],
];
const NEEDLES = [GHP, GHP.slice(4, 16), SK.slice(8, 20), USER, 'gh' + 'p_A1b2'];
const clean = (said: string | null, what: string): void => {
  ok(typeof said === 'string' && said.length > 0, `${what}: something is said`);
  const plainSaid = shared.unhide(String(said)); // what a screen reader may read past: hidden characters do not hide a needle
  for (const x of NEEDLES) ok(!plainSaid.includes(x), `${what}: "${x.slice(0, 6)}..." is not said: ${String(said).slice(0, 120)}`);
};

// 1. the lines of the call sites that interpolate an agent's or a folder's name (issue #1419; app.js and screens.js), each with every hostile name
const LINES: [string, (x: string) => string][] = [
  ['finished, new reply (#1419)', (x) => x + ' finished. New reply.'],
  ['marked as read', (x) => x + ': marked as read.'],
  ['asks', (x) => x + ' asks: a question'],
  ['needs your OK', (x) => x + ' needs your OK: run tests'],
  ['Retry now', (x) => 'Retry now: ' + x],
  ['Auto-follow arrival', (x) => x + ' finished. Its chat is open.'],
  ['position', (x) => x + ', 2 of 5.'],
  ['moved', (x) => x + ' moved to position 2 of 4 in its room.'],
  ['nowhere to move', (x) => x + ' has nowhere to move.'],
  ['notes of a folder', (x) => 'Notes of ' + x + '. No notes yet.'],
  ['folder back on a floor', (x) => x + ' is back on Floor 1.'],
  ['request went away', (x) => 'That request went away. Focus is on ' + x + '. Move to a row before answering.'],
  ['could not answer', (x) => 'Could not answer. ' + x + '.'],
  ['chat palette', (x) => 'Chat 3, ' + x + '. Type a message and press Enter to send.'],
  ['MCP sign-in', (x) => 'Signed in to ' + x + '.'],
];
const P = page(true);
for (const [nm, name] of NAMES) for (const [ln, mk] of LINES) clean(P.say(mk(name)), `${ln} with ${nm}`);
// the request lines come as parts, [name, rest] (app.js: needs your OK, asks): the name is masked alone
for (const [nm, name] of NAMES) {
  clean(P.say([name, ' needs your OK: run tests']), `parts: needs your OK with ${nm}`);
  clean(P.say([name, ' asks: a question'], 1), `parts: asks with ${nm}`);
}
// Durbar's own words stay as they are
eq(P.say('Ada finished. New reply.'), 'Ada finished. New reply.', 'a plain name is said as it is');
eq(P.say('Showing all agents.'), 'Showing all agents.', 'a plain line is said as it is');
const said = P.say('fix ' + GHP + ' finished. New reply.');
ok(String(said).endsWith(' finished. New reply.') && String(said).includes('[redacted]'), `the token is replaced, the rest is kept: ${said}`);
ok(!String(P.say('/home/' + USER + '/repo finished.')).includes(USER), 'the home folder user name is gone');

// 2. mask before the cut: a token across the 300-character cut leaves no piece of itself
const long = P.say('x'.repeat(290) + ' ' + GHP + ' finished.');
ok(typeof long === 'string' && long.length <= 300, 'the line is cut at 300');
ok(!/ghp|A1b2/.test(String(long)), `a token across the cut leaves no piece: ...${String(long).slice(280)}`);

// 3. a spoken command is the one that runs (review of PR 1484): the desk mask undoes Markdown escapes, so a part it finds nothing in is
// said as written. `echo \\$(id)` runs `id`; said with its escapes undone it would sound like the harmless `echo \$(id)`.
const ST = require(path.join(R_DIR, 'safetext.js')) as { unesc(t: string): string };
const CMDS = ['run echo \\\\$(id)', 'run echo \\$(id)', 'run echo a \\> b', 'run git log \\*.md', 'run rm -rf \\_build \\[x\\]'];
ok(ST.unesc(CMDS[0]) !== CMDS[0] && ST.unesc(CMDS[0]) === 'run echo \\$(id)', 'the first command has an escape the desk mask would undo');
for (const c of CMDS) {
  eq(P.say(['Ada', ' needs your OK: ' + c]), 'Ada needs your OK: ' + c, `the command is said as written: ${c}`);
  eq(P.say('Ada needs your OK: ' + c), 'Ada needs your OK: ' + c, `one string: the command is said as written: ${c}`);
  eq(P.say(['Ada', ' asks: ' + c], 1), 'Ada asks: ' + c, `a question is said as written: ${c}`);
  // a name with a token and a command with an escape: the name is masked, the command still said as written
  const m = P.say(['fix ' + GHP, ' needs your OK: ' + c]);
  eq(m, 'fix [redacted] needs your OK: ' + c, `a masked name keeps the command as written: ${c}`);
  // one part with both a secret and an escape: never said with the escapes undone
  // (`\\$` is no Markdown escape: such a part is masked as usual, nothing else changes)
  const esc1 = ST.unesc(c) !== c;
  eq(P.say(['Ada', ' needs your OK: ' + c + ' --token ' + GHP]), esc1 ? 'Ada[redacted]' : 'Ada needs your OK: ' + c + ' --token [redacted]',
    `a part with a secret and an escape is hidden whole: ${c}`);
}
ok(!String(P.say(['Ada', ' needs your OK: run echo ghp\\_' + GHP.slice(4)])).includes(GHP.slice(4, 16)), 'an escaped token in the request is still hidden');

// 4. fail closed: without the redact module, with a throwing or failing mask, or in the simulator's noredact mode, a fixed line is said, never the text
eq(page(false).unchecked, UNCHECKED, 'the fixed line');
for (const [what, mode] of [['no redact module', false], ['a throwing mask', 'throws'], ['a failing mask ([redaction failed])', 'failed'], ['noredact mode', 'noredact']] as [string, Mode][]) {
  const F = page(mode);
  eq(F.say('fix ' + GHP + ' finished. New reply.'), UNCHECKED, `${what}: the fixed line, not the raw text`);
  eq(F.say(['/home/' + USER, ' needs your OK: run tests'], 1), UNCHECKED, `${what}: no home folder either`);
  eq(F.say('Showing all agents.'), UNCHECKED, `${what}: Durbar's own words are not said either (the trade-off, FR-178)`);
}
// a line that masks to nothing (blank) says nothing and does not take the slot of a waiting one
eq(P.say('   '), null, 'a blank line is not said');
eq(P.say(['', '  ']), null, 'blank parts are not said');
P.queue('Ada finished. New reply.'); P.queue('   '); eq(P.fire(), 'Ada finished. New reply.', 'a blank line does not push a waiting line aside');
P.queue('Ada needs your OK: run tests', 1); P.queue('Showing all agents.'); eq(P.fire(), 'Ada needs your OK: run tests', 'a request outranks a status (spec 005 FR-237)');

// 5. sources: every announcement goes through this one function
const fnAnn = line('function announce(');
ok(/const said=annMask\(text\)/.test(fnAnn) && /textContent=said\.slice\(0,300\)/.test(fnAnn), 'announce masks, then cuts what it masked');
ok(!/String\(text\)/.test(fnAnn), 'announce never puts the unmasked text in the live region');
ok(/const h=annHome\(s\)/.test(line('function annPart(')) && /deskMask\(h\)/.test(line('function annPart(')) && /homeMask\(c\)/.test(line('function annHome(')) && /homeMask\(s\)/.test(line('function annHome(')), 'annPart is the helpers\' masks (home folders first, then the desk mask)');
const writers = fs.readdirSync(R_DIR).filter((f) => f.endsWith('.js')).filter((f) => /srAnnounce/.test(fs.readFileSync(path.join(R_DIR, f), 'utf8')));
eq(writers, ['app.js'], 'only app.js touches #srAnnounce');
eq((app.match(/srAnnounce/g) || []).length, 1, 'app.js touches #srAnnounce in announce() only');
for (const f of ['screens.js', 'newfolder.js']) ok(!/function announce\s*\(/.test(fs.readFileSync(path.join(R_DIR, f), 'utf8')), `${f} has no announce of its own`);
// the call's own argument, read by matching brackets (strings, template text and comments skipped), and only its top level: `announce` is
// passed as itself, not somewhere nested or far after it
const topLevel = (head: string): string => {
  const i = app.indexOf(head); assert.ok(i >= 0, head); let d = 0, out = '';
  for (let j = i + head.length - 1; j < app.length; j++) {
    const c = app[j];
    if (c === "'" || c === '"' || c === '`') { const q = c; j++; while (j < app.length && app[j] !== q) { if (app[j] === '\\') j++; j++; } if (d === 1) out += q + q; continue; }
    if (c === '/' && app[j + 1] === '*') { j = app.indexOf('*/', j + 2) + 1; continue; }
    if (c === '/' && app[j + 1] === '/') { j = app.indexOf('\n', j); continue; }
    if ('({['.includes(c)) { d++; if (d === 2) out += c; continue; }
    if (')}]'.includes(c)) { if (d === 2) out += c; d--; if (d === 0) return out; continue; }
    if (d === 1) out += c;
  }
  throw new Error('no end of ' + head);
};
ok(/[{,]\s*announce\s*[,}]/.test(topLevel('window.DurbarScreens.init({')), 'screens.js gets the page\'s announce');
ok(/[{,]\s*announce\s*[,}]/.test(topLevel('DurbarNewFolder.create({')), 'newfolder.js gets the page\'s announce');
// the request lines pass the name as its own part (a token-shaped name cannot undo the escapes of the command)
ok(/announce\(\[a\.name,' needs your OK: '\+\(look/.test(app) && /announce\(\[a\.name,\(c\.classList\.contains\('question'\)/.test(app) && /announce\(\[a\.name,' asks: '/.test(app), 'the request lines pass the name as its own part');

console.log('test-announce-mask: OK (' + n + ' checks)');
