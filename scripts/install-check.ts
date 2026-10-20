/**
 * Spec 060 T060 (owner, 2026-10-20): install each agent app through every route Durbar offers on THIS machine, for real, through the
 * same `HarnessSetup` code the app uses (plans → official download → argv run), then check that Durbar finds it and that `--version`
 * runs. Meant for clean CI runners (workflow "Install check"), once as a standard user and once as an admin user. No account, no
 * sign-in, no AI. NEVER run it on your own machine: it installs software into your home folder.
 *
 *   node dist-scripts/scripts/install-check.js <label> <out.json> [--only claude,codex]
 *
 * Prints a Markdown table (for the job summary) and writes the same rows as JSON.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarnessSetup } from '../src/main/harnesssetup';
import type { SetupDone } from '../src/main/harnesssetup';
import { detectBinary, nodeDetectEnv, nodeExec } from '../src/adapters/detect';
import type { SetupKind } from '../src/shared/harnesssetup';
import { spawn, execFile } from 'child_process';

const KINDS: { kind: SetupKind; bin: string }[] = [{ kind: 'claude', bin: 'claude' }, { kind: 'copilot', bin: 'copilot' }, { kind: 'codex', bin: 'codex' }];

interface Row { who: string; os: string; app: SetupKind; route: string; display: string; note?: string; ok: boolean; exit?: number | null; secs: number; foundAt?: string; version?: string; error?: string; tail?: string }

function killTree(child: { pid?: number }): void {
  if (!child.pid) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => undefined);
  else try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
}

async function main(): Promise<void> {
  const [who, outFile] = process.argv.slice(2);
  if (!who || !outFile) throw new Error('usage: install-check.js <label> <out.json> [--only claude,codex]');
  const i = process.argv.indexOf('--only');
  const only = i > 0 ? new Set(process.argv[i + 1].split(',')) : undefined;
  if (process.platform === 'win32') {
    // the standard user is started from the admin account and inherits its TEMP; a real user has their own (CI only)
    const own = os.userInfo().homedir;
    const tmp = path.join(own, 'AppData', 'Local', 'Temp');
    if (!(process.env.TEMP ?? '').toLowerCase().startsWith(own.toLowerCase())) {
      fs.mkdirSync(tmp, { recursive: true });
      process.env.TEMP = process.env.TMP = tmp;
      process.env.USERPROFILE = own;
      process.env.APPDATA = path.join(own, 'AppData', 'Roaming');
      process.env.LOCALAPPDATA = path.join(own, 'AppData', 'Local');
    }
  }
  const env = nodeDetectEnv();
  let done: ((d: SetupDone) => void) | undefined;
  const hs = new HarnessSetup({
    detectEnv: env,
    spawn: (file, args, opts) => spawn(file, args, { ...opts, shell: false }) as never,
    killTree: killTree as never,
    send: ((ch: string, p: unknown) => { if (ch === 'harness:done' && done) done(p as SetupDone); }) as never,
    redetect: async () => undefined,
    isRoot: () => typeof process.getuid === 'function' && process.getuid() === 0,
    limits: { install: 12 * 60_000, signin: 60_000 },
  });
  const rows: Row[] = [];
  for (const { kind, bin } of KINDS) {
    if (only && !only.has(kind)) continue;
    const plans = hs.plans(kind, 'install').plans;
    if (!plans.length) rows.push({ who, os: process.platform, app: kind, route: '(none)', display: 'no route on this machine', ok: false, secs: 0 });
    for (let idx = 0; idx < plans.length; idx++) {
      const plan = plans[idx];
      const t0 = Date.now();
      const row: Row = { who, os: process.platform, app: kind, route: plan.manager, display: plan.display, note: plan.note, ok: false, secs: 0 };
      const p = hs.prepare(kind, 'install', idx);
      if (!p.ok) { row.error = p.error; rows.push(row); continue; }
      const ready = await hs.withScript(p.job);
      if (!ready.ok) { row.error = ready.error; row.secs = Math.round((Date.now() - t0) / 1000); rows.push(row); continue; }
      const end = new Promise<SetupDone>((r) => { done = r; });
      const s = hs.start(ready.job);
      if (!s.ok) { row.error = s.error; rows.push(row); continue; }
      const d = await end;
      row.exit = d.exitCode;
      row.secs = Math.round((Date.now() - t0) / 1000);
      row.tail = d.lines.slice(-3).join(' | ').slice(0, 300);
      const det = await detectBinary({ name: bin, versionArgs: ['--version'], installHint: '' }, nodeDetectEnv(), nodeExec);
      row.foundAt = det.path;
      row.version = 'version' in det ? (det as { version?: string }).version : undefined;
      row.ok = d.ok && !!det.path && det.state !== 'not-installed';
      if (!d.ok) row.error = d.reason ?? `exit ${d.exitCode}`;
      rows.push(row);
    }
  }
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 2));
  const esc = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  console.log(`\n### Install check: ${who} on ${process.platform}\n\n| App | Route | Admin note | Result | Found at | Version | Time | Detail |\n|---|---|---|---|---|---|---|---|`);
  for (const r of rows) console.log(`| ${r.app} | ${esc(r.route)} | ${esc(r.note)} | ${r.ok ? 'ok' : 'FAIL'} | ${esc(r.foundAt)} | ${esc(r.version)} | ${r.secs} s | ${esc(r.error ?? r.tail)} |`);
}
main().catch((e) => { console.error('install-check:', e instanceof Error ? e.message : e); process.exit(1); });
