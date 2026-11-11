/**
 * Spec 012 FR-178 (issue #1419): the screen-reader announcements (`announce()` in `src/renderer/app.js`, the polite live region
 * `#srAnnounce`) mask the whole line: home folders on the raw text, then the desk mask, then the 300-character cut. An agent or folder name
 * can hold a token-shaped string or a home folder, and many lines are built from one (`<name> finished. New reply.`).
 * The page's own definitions (`homeMask`, `helperMask`, `deskMask`, `SAFE`, `annMask`, `announce`) are cut out of app.js and run in a
 * sandbox with the compiled shared mask and safetext.js, so a change to the page's code is what is tested. Source checks keep every caller
 * on that one function. Fake tokens only, built at run time. `npm run test:announcemask`. No credits spent.
 */
import './safetext-shared';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import * as shared from '../src/shared/redact';

const R = path.join(__dirname, '..', '..', 'src', 'renderer');
const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
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
  'const safeExcerpt=', 'let announceT=', 'const ANN_REQUEST=', 'function annMask(', 'function announce('].map(line).join('\n');

type Page = { say(text: unknown, prio?: number): string | null };
// a page with (or without) the redact module; `say` announces and runs the 60 ms timer, giving what the live region holds (null: untouched)
const page = (withRedact: boolean | 'throws'): Page => {
  const el: { textContent: string | null } = { textContent: null };
  let timer: (() => void) | null = null;
  const ctx = vm.createContext({
    window: { DurbarRedact: withRedact === 'throws' ? { ...shared, maskHomePaths: () => { throw new Error('boom'); } } : withRedact ? shared : undefined, DurbarSafeText: require(path.join(R, 'safetext.js')) },
    DurbarCutText: require(path.join(R, 'cuttext.js')),
    NO_REDACT: !withRedact,
    $: (id: string) => (id === 'srAnnounce' ? el : null),
    setTimeout: (f: () => void) => { timer = f; return 1; },
    clearTimeout: () => { timer = null; },
  });
  vm.runInContext(DEFS + '\nthis.announce=announce;', ctx);
  const announce = (ctx as unknown as { announce(t: unknown, p?: number): void }).announce;
  return {
    say(text, prio) { el.textContent = null; timer = null; announce(text, prio); if (timer) (timer as () => void)(); return el.textContent; },
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
];
const NEEDLES = [GHP, GHP.slice(4, 16), SK.slice(8, 20), USER, 'gh' + 'p_A1b2'];
const clean = (said: string | null, what: string): void => {
  ok(typeof said === 'string' && said.length > 0, `${what}: something is said`);
  for (const x of NEEDLES) ok(!String(said).includes(x), `${what}: "${x.slice(0, 6)}..." is not said: ${String(said).slice(0, 120)}`);
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

// 3. fail closed: without the redact module nothing is said, not the raw line
const N = page(false);
eq(N.say('fix ' + GHP + ' finished. New reply.'), null, 'no redact module: nothing is said');
eq(N.say('/home/' + USER + ' finished.'), null, 'no redact module: no home folder is said either');
// a mask that throws: nothing is said (annMask's catch), not the raw line
eq(page('throws').say('fix ' + GHP + ' finished. New reply.'), null, 'a throwing mask: nothing is said');
// an empty line after masking says nothing and does not take the slot of a waiting one
eq(P.say(''), null, 'an empty line is not said');

// 4. sources: every announcement goes through this one function
const fnAnn = line('function announce(');
ok(/const said=annMask\(text\)/.test(fnAnn) && /textContent=said\.slice\(0,300\)/.test(fnAnn), 'announce masks, then cuts what it masked');
ok(!/String\(text\)/.test(fnAnn), 'announce never puts the unmasked text in the live region');
ok(/helperMask\(String\(t\)\)/.test(line('function annMask(')), 'annMask is the helpers\' mask (home folders first, then the desk mask)');
const writers = fs.readdirSync(R).filter((f) => f.endsWith('.js')).filter((f) => /srAnnounce/.test(fs.readFileSync(path.join(R, f), 'utf8')));
eq(writers, ['app.js'], 'only app.js touches #srAnnounce');
eq((app.match(/srAnnounce/g) || []).length, 1, 'app.js touches #srAnnounce in announce() only');
for (const f of ['screens.js', 'newfolder.js']) ok(!/function announce\s*\(/.test(fs.readFileSync(path.join(R, f), 'utf8')), `${f} has no announce of its own`);
ok(/DurbarScreens\.init\(\{[\s\S]{0,4000}\bannounce,/.test(app), 'screens.js gets the page\'s announce');
ok(/DurbarNewFolder\.create\(\{[^}]*\bannounce\b/.test(app), 'newfolder.js gets the page\'s announce');

console.log('test-announce-mask: OK (' + n + ' checks)');
