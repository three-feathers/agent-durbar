/**
 * Spec 080 T017 (FR-030, FR-031, FR-033, FR-024): links in the chat. `npm run test:chatlinks`. No Electron, no network, no credits.
 *  1. the setting `chatLinksIn`: default Session browser, only `system` is stored, garbage is ignored, the default is not written;
 *  2. FR-033: every other `shell.openExternal` path keeps the system browser, unchanged (the exact list of call sites);
 *  3. the click handler: preventDefault first, Ctrl/Cmd+click and the menu item use `openExternal`, a plain click asks main, the setting decides,
 *     the refusal text and the mail offer come from main, nothing the page says is shown unescaped.
 * The controller's classification (hostile list, session isolation) is in `test:browseripc`; the clicks in `check-browser-links`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseSettings } from '../src/shared/credits';
import { SettingsStore } from '../src/main/settings';
import { stripComments } from './ipc-channel-list';

const ROOT = path.join(__dirname, '..', '..');
const raw = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const code = (f: string): string => stripComments(raw(f));

// ---- 1. the setting ----
assert.deepStrictEqual(parseSettings('{"chatLinksIn":"system"}'), { chatLinksIn: 'system' });
for (const v of ['"session"', '"System"', '"other"', 'true', '1', 'null', '{}']) assert.deepStrictEqual(parseSettings('{"chatLinksIn":' + v + '}'), {}, 'only "system" is kept: ' + v);
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-cl-'));
  const f = path.join(dir, 'durbar-settings.json');
  const st = new SettingsStore(f);
  st.load();
  assert.strictEqual(st.chatLinksIn, 'session', 'the default is the session browser');
  assert.strictEqual(st.setChatLinksIn('bogus'), 'session', 'anything else keeps the value');
  assert.strictEqual(st.setChatLinksIn(5), 'session');
  assert.strictEqual(st.setChatLinksIn('system'), 'system');
  const back = new SettingsStore(f);
  back.load();
  assert.strictEqual(back.chatLinksIn, 'system', 'kept after a restart');
  assert.strictEqual(back.setChatLinksIn('bogus'), 'system', 'garbage does not reset it');
  assert.strictEqual(back.setChatLinksIn('session'), 'session');
  assert.ok(!('chatLinksIn' in JSON.parse(fs.readFileSync(f, 'utf8'))), 'the default is not written');
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const ipc = code('src/main/ipc/settings.ts');
  assert.ok(/chatLinksIn: settingsStore\(\)\?\.chatLinksIn \?\? 'session'/.test(ipc), 'settings:get reports it, defaulting to the session browser');
  assert.ok(/ipcHandle\('settings:setChatLinksIn'/.test(ipc));
  const sim = code('src/renderer/sim.ts');
  assert.ok(/let chatLinksIn: 'session' \| 'system' = 'session'/.test(sim) && /setChatLinksIn: async/.test(sim), 'the simulator\'s stand-in keeps the same default');
  assert.ok(/CHAT_LINKS=v&&v\.chatLinksIn==='system'\?'system':'session'/.test(code('src/renderer/app.js')), 'the window reads it with the same default');
  const scr = code('src/renderer/screens.js');
  assert.ok(/Open chat links in/.test(scr) && /<option value="session"[^>]*>Session browser<\/option><option value="system"[^>]*>System browser<\/option>/.test(scr), 'the Settings row offers Session browser and System browser');
}

// the scan also finds the forms that dodge `shell.openExternal(`: `const { openExternal } = shell`, `shell['openExternal']`, `const f = shell.openExternal`, `require('electron').shell`
function aliasesOf(src: string): string[] {
  const out: string[] = [];
  if (/\bshell\s*\[\s*['"`]openExternal['"`]\s*\]/.test(src)) out.push('shell[\'openExternal\']');
  if (/\{[^}]*\bopenExternal\b[^}]*\}\s*=\s*(?:shell\b|require\(\s*['"]electron['"]\s*\)\.shell\b)/.test(src)) out.push('destructured openExternal');
  if (/=\s*shell\.openExternal\b(?!\s*\()/.test(src) || /\bshell\.openExternal\b(?!\s*\()/.test(src.replace(/\bshell\.openExternal\(/g, ''))) out.push('shell.openExternal used as a value');
  if (/\brequire\(\s*['"]electron['"]\s*\)\s*\.\s*shell\b/.test(src) || /\bshell\s*:\s*\w+\b[^;]*\bfrom\s+['"]electron['"]/.test(src)) out.push('shell aliased through require');
  if (/import\s*\{[^}]*\bshell\s+as\b/.test(src)) out.push('shell imported under another name');
  return out;
}
for (const [sample, found] of [["const { openExternal } = shell;", 1], ["shell['openExternal'](u)", 1], ["const f = shell.openExternal; f(u)", 1], ["require('electron').shell.openExternal(u)", 1], ["import { shell as sh } from 'electron'", 1], ["await shell.openExternal(u);", 0], ["import { shell } from 'electron';", 0]] as const) {
  assert.strictEqual(aliasesOf(sample).length > 0 ? 1 : 0, found, `the alias scan on: ${sample}`);
}
// ---- 2. FR-033: the other openExternal paths ----
{
  const EXPECT: Record<string, number> = {
    'src/main/ipc/app.ts': 1, // app:openExternal (chat links to the system browser, unchanged)
    'src/main/ipc/questions.ts': 1, // agents:openElicitationUrl (MCP elicitation pages, often OAuth)
    'src/main/ipc/remote.ts': 1, // remote control (spec 054)
    'src/main/ipc/harness.ts': 2, // official pages and setup sign-in (spec 051)
    'src/main/main.ts': 2, // openRepo, and the MCP sign-in openUrl (spec 058 FR-065)
    'src/main/ipc/browser.ts': 1, // the session browser's own dependency: Open in system browser and the mail click
  };
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|js)$/.test(e.name) ? [path.join(d, e.name)] : []));
  const found: Record<string, number> = {};
  for (const f of walk(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    const n = (src.match(/\bshell\.openExternal\(/g) ?? []).length;
    if (n) found[rel] = n;
    assert.deepStrictEqual(aliasesOf(src), [], `${rel}: openExternal is reached only as shell.openExternal(...) (no alias, destructuring or computed name)`);
  }
  assert.deepStrictEqual(found, EXPECT, 'the call sites of shell.openExternal are exactly the known ones (a new one needs this list and its spec)');
  // each one still does what FR-033 lists
  assert.ok(/ipcHandle\('app:openExternal', async \(_e, url: unknown\) => \{\n\s*if \(!isHttpUrl\(url\)\) return \{ ok: false \};\n\s*await shell\.openExternal\(url\);/.test(code('src/main/ipc/app.ts')), 'app:openExternal: http(s) only, unchanged');
  assert.ok(/ipcHandle\('agents:openElicitationUrl'/.test(code('src/main/ipc/questions.ts')) && /shell\.openExternal\(u\.url\)/.test(code('src/main/ipc/questions.ts')));
  assert.ok(/open: \(url\) => shell\.openExternal\(url\)/.test(code('src/main/ipc/remote.ts')));
  const h = code('src/main/ipc/harness.ts');
  assert.ok(/shell\.openExternal\(OFFICIAL_PAGES\[kind\]\)/.test(h) && /shell\.openExternal\(new URL\(url\)\.href\)/.test(h));
  const m = code('src/main/main.ts');
  assert.ok(/openUrl: \(url\) => shell\.openExternal\(url\)/.test(m) && /openRepo: \(\) => void shell\.openExternal\(REPO_URL\)/.test(m));
  // the profile editor's preview keeps its own handler; the chat's link rule is not applied there
  const pe = code('src/renderer/profileeditor.js');
  assert.ok(/\$\('pePrev'\)\.addEventListener\('click'/.test(pe) && !/openChatLink|browserOpenLink|BP\./.test(pe), 'the profile editor preview is untouched by the chat-link rule');
  // the harness, questions and remote pages never call the browser's link channel
  for (const f of ['src/main/ipc/questions.ts', 'src/main/ipc/remote.ts', 'src/main/ipc/harness.ts', 'src/main/mcpipc.ts']) assert.ok(!/openLink|browserOpen|browser:/.test(code(f)), `${f} does not route through the session browser`);
}

// ---- 3. the click handler in the window ----
{
  const app = code('src/renderer/app.js');
  const click = app.slice(app.indexOf("document.addEventListener('click',e=>{\n  const lk=e.target.closest('.md a');"));
  assert.ok(/const lk=e\.target\.closest\('\.md a'\);\n\s*if\(lk\)\{e\.preventDefault\(\);/.test(click), 'a chat link click never navigates the window: preventDefault first');
  assert.ok(/openChatLink\(u,IS_MAC\?e\.metaKey:e\.ctrlKey\)/.test(click), 'Cmd on a Mac, Ctrl elsewhere');
  const fn = app.slice(app.indexOf('async function openChatLink'), app.indexOf('function openLinkMenu'));
  assert.ok(/const route=BP\.linkRoute\(web,mod,CHAT_LINKS,!!root&&BP\.available\(root\)\);\n\s*if\(route==='system'\)return openLinkExternal\(u\)/.test(fn), 'Ctrl/Cmd+click, the System setting and a missing root use the existing openExternal (BP.linkRoute is tested in test:browserpane)');
  assert.ok(/BP\.openLink\(root\.id,u\)/.test(fn), 'a plain click asks main for the chat\'s root session');
  assert.ok(/r\.fallback\)\{if\(web\)openLinkExternal\(u\)/.test(fn), 'Not now on the note: the system browser, this time');
  assert.ok(/r\.link==='mailto'\)\{toastAction\(esc\(r\.reason\),'Open',\(\)=>BP\.openMail\(u\)/.test(fn), 'a mail link offers Open; only that click reaches the system');
  assert.ok(/toast\(esc\(\(r&&r\.reason\)\|\|REFUSED_LINK\),4200\)/.test(fn) && !/toastAction\([^)]*REFUSED_LINK/.test(fn), 'every other scheme: the refusal text, no button');
  assert.ok(!/\bshell\b|openExternal\(u\)/.test(fn.replace(/openLinkExternal\(u\)/g, '')), 'the handler reaches the system only through openLinkExternal');
  const ext = app.slice(app.indexOf('function openLinkExternal'), app.indexOf('function showSessionBrowser'));
  assert.ok(/if\(!\/\^https\?:\\\/\\\/\/i\.test\(u\)\)return;/.test(ext) && /bridge\.openExternal\(u\)/.test(ext) && /safeMask\(u\)/.test(ext) && /esc\(/.test(ext), 'openLinkExternal: http(s) only, the demo toast masks and escapes the address');
  const menu = app.slice(app.indexOf('function openLinkMenu'), app.indexOf("document.addEventListener('contextmenu',e=>{\n  const lk="));
  assert.ok(/id='modeMenu'/.test(menu) && /Open in system browser/.test(menu) && /openLinkExternal\(u\)/.test(menu), 'the menu is the shared menu element and its item goes to openExternal');
  // the markdown renderer: mail links keep their href, other schemes lose it, the simulator's pages only in the simulator
  const md = code('src/renderer/markdown.js');
  assert.ok(/ALLOWED_URI_REGEXP:\/\^\(\?:https\?:\\\/\\\/\|mailto:\)\/i/.test(md), 'the sanitiser lets http(s) and mailto: through, nothing else');
  assert.ok(/if\(SIM&&window\.DurbarMD&&window\.DurbarMD\.allowSimLinks\)window\.DurbarMD\.allowSimLinks\(\)/.test(app), 'the simulator pages are links only under the simulator');
  // channels
  assert.ok(/browserOpenLink: \(id, url\) => ipcRenderer\.invoke\('browser:openLink', id, url\)/.test(code('src/preload/preload.ts')));
}
console.log('chat links tests passed');
