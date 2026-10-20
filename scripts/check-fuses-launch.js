// Spec 008 FR-039: launch probe on the packed Linux app (run by hand: `npm run check:fuses-launch`, which wraps it in xvfb-run).
// Starts release/linux-unpacked/agent-durbar with a temporary profile and checks, for each case, that the window still opens
// and that no inspector or DevTools endpoint answers. It signs in to nothing and starts no agent session.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const BIN = path.resolve(process.argv[2] || path.join('release', 'linux-unpacked', 'agent-durbar'));
const WINDOW_TIMEOUT_MS = 30000;
const QUIET_MS = 2500; // after the window opens, wait this long for a late endpoint

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const windowOpen = () => {
  try { return /"Agent Durbar"/.test(execFileSync('xwininfo', ['-root', '-tree'], { encoding: 'utf8' })); } catch { return false; }
};
const canConnect = (port) => new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
});
const httpOk = (port) => new Promise((resolve) => {
  const req = require('http').get({ host: '127.0.0.1', port, path: '/json/version', timeout: 2000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
  req.on('error', () => resolve(false));
  req.on('timeout', () => { req.destroy(); resolve(false); });
});

/** Runs one probe case; resolves { name, windowOpened, stderr } after the quiet period, then stops the app by PID. */
async function launch(name, args, env, extraPipes, after) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-fuses-'));
  const child = spawn(BIN, ['--no-sandbox', ...args], {
    env: { ...process.env, XDG_CONFIG_HOME: profile, ...env },
    stdio: ['ignore', 'pipe', 'pipe', ...(extraPipes ? ['pipe', 'pipe'] : [])],
  });
  for (const s of child.stdio.slice(3)) s.on('error', () => {}); // the app may close the pipe
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const t0 = Date.now();
  while (!windowOpen() && !exited && Date.now() - t0 < WINDOW_TIMEOUT_MS) await sleep(300);
  const windowOpened = windowOpen();
  await sleep(QUIET_MS);
  if (after) await after(child);
  child.kill('SIGTERM');
  for (let i = 0; i < 50 && !exited; i++) await sleep(100);
  if (!exited) child.kill('SIGKILL');
  fs.rmSync(profile, { recursive: true, force: true });
  return { name, windowOpened, output };
}

(async () => {
  if (process.platform !== 'linux') { console.error('check-fuses-launch: Linux only (macOS and Windows are checked by hand, issue #9)'); process.exit(1); }
  if (!fs.existsSync(BIN)) { console.error(`check-fuses-launch: packed binary not found: ${BIN}\nRun "npm run pack:dir" first.`); process.exit(1); }
  if (!process.env.DISPLAY) { console.error('check-fuses-launch: no DISPLAY; run it through "npm run check:fuses-launch" (xvfb-run)'); process.exit(1); }
  const noInspector = (r) => !/Debugger listening|DevTools listening|Waiting for the debugger/i.test(r.output);
  const results = [];
  const add = (r, ok, why) => results.push({ name: r.name, ok: r.windowOpened && ok, why: r.windowOpened ? why : `window did not open; output tail: ${r.output.slice(-300)}` });

  for (const flag of ['--inspect', '--inspect-brk']) {
    const port = await freePort();
    let connected = false;
    const r = await launch(`${flag}=${port}`, [`${flag}=${port}`], {}, false, async () => { connected = await canConnect(port); });
    add(r, !connected && noInspector(r), `window opened, no inspector message, connect to 127.0.0.1:${port} ${connected ? 'SUCCEEDED' : 'refused'}`);
  }
  for (const [label, make] of [
    ['--remote-debugging-port', (p) => `--remote-debugging-port=${p}`],
    ['-remote-debugging-port (single dash)', (p) => `-remote-debugging-port=${p}`],
    ['--REMOTE-DEBUGGING-PORT (upper case)', (p) => `--REMOTE-DEBUGGING-PORT=${p}`],
  ]) {
    const port = await freePort();
    let answered = false;
    const r = await launch(label, [make(port)], {}, false, async () => { answered = await httpOk(port); });
    add(r, !answered && noInspector(r), `window opened, GET http://127.0.0.1:${port}/json/version ${answered ? 'ANSWERED' : 'did not answer'}`);
  }
  {
    let replied = false;
    const r = await launch('--remote-debugging-pipe', ['--remote-debugging-pipe'], {}, true, (child) => new Promise((resolve) => {
      child.stdio[4].on('data', () => { replied = true; });
      child.stdio[3].write('{"id":1,"method":"Browser.getVersion"}\0');
      setTimeout(resolve, 3000);
    }));
    add(r, !replied && noInspector(r), `window opened, CDP message on the pipe ${replied ? 'GOT A REPLY' : 'got no reply'}`);
  }
  {
    const r = await launch('ELECTRON_RUN_AS_NODE=1 + NODE_OPTIONS=--inspect=0', [], { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect=0' });
    add(r, noInspector(r), 'the app started (window opened, not Node), no inspector message');
  }

  let bad = 0;
  for (const r of results) {
    console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.why}`);
    if (!r.ok) bad++;
  }
  if (bad) { console.error(`check-fuses-launch: ${bad} case(s) failed`); process.exit(1); }
  console.log(`check-fuses-launch: all ${results.length} cases passed`);
})().catch((e) => { console.error('check-fuses-launch:', e.message); process.exit(1); });
