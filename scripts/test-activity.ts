/** Activity log (spec 052 FR-071): store cap, redaction, CSV escaping and formula-injection guard, only the listed fields. `npm run test:activity`. No credits spent. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ActivityStore } from '../src/main/activitystore';
import { ACTIVITY_DECISIONS, ACTIVITY_FIELDS, ACTIVITY_MAX_ROWS, activityCsv, activityJson, csvCell, decisionOf, sanitizeActivityRow } from '../src/shared/activity';
import type { ActivityRow } from '../src/shared/activity';
import { setCapOp, setModeOp } from '../src/main/agentops';
import type { OpsDeps } from '../src/main/agentops';
import { loopActivity } from '../src/main/loopwiring';
import type { LoopNote } from '../src/main/schedules';
import type { AgentInfo } from '../src/shared/api';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const T = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'activitytable.js')) as {
  DECISION_WORDS: Record<string, string>;
  NOTE: string;
  EMPTY: string;
  tableHtml: (rows: unknown, esc: (s: string) => string) => string;
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-activity-'));
const file = path.join(dir, 'activity.json');
const noTimer = { setTimer: () => 1, clearTimer: () => undefined };
const base = { agent: 'Ana', folder: '/home/u/work/web-shop', app: 'GitHub Copilot', mode: 'ask', action: 'Edit src/a.ts', decision: 'allowed-once' as const };

try {
  // only the listed fields are stored; the folder is a base name; extra keys (prompt, output, ...) are dropped
  {
    const st = new ActivityStore(file, { ...noTimer, env: {} });
    const r = st.record({ ...base, prompt: 'secret prompt', reply: 'model reply', output: 'tool output', content: 'file body' });
    assert.ok(r);
    assert.deepStrictEqual(Object.keys(r!).sort(), [...ACTIVITY_FIELDS].sort(), 'a row has exactly the listed fields');
    assert.strictEqual(r!.folder, 'web-shop', 'folder base name, not the full path');
    assert.strictEqual(sanitizeActivityRow({ ...base, t: new Date().toISOString(), folder: 'C:\\Users\\u\\proj\\' })!.folder, 'proj', 'Windows path: base name');
    st.flush();
    const disk = fs.readFileSync(file, 'utf8');
    for (const bad of ['secret prompt', 'model reply', 'tool output', 'file body', '/home/u']) assert.ok(!disk.includes(bad), `not on disk: ${bad}`);
    const back = new ActivityStore(file, { ...noTimer, env: {} });
    back.load();
    assert.strictEqual(back.list().length, 1, 'reloaded');
    assert.strictEqual(back.list()[0].action, 'Edit src/a.ts');
    // unknown decisions and bad times are refused
    assert.strictEqual(st.record({ ...base, decision: 'hacked' as never }), undefined);
    assert.strictEqual(sanitizeActivityRow({ ...base, t: 'not a date' }), undefined);
  }

  // redaction and the 160-character action cap; one line only
  {
    const st = new ActivityStore(path.join(dir, 'r.json'), { ...noTimer, env: { MY_API_TOKEN: 'supersecretvalue123' } });
    const r1 = st.record({ ...base, action: 'Run curl -H "Authorization: Bearer abcdefghijklmnop" with ghp_' + 'a'.repeat(36) });
    assert.ok(!/abcdefghijklmnop/.test(r1!.action) && !/ghp_a{36}/.test(r1!.action) && /\[redacted\]/.test(r1!.action), r1!.action);
    const r2 = st.record({ ...base, action: 'echo supersecretvalue123' });
    assert.ok(!r2!.action.includes('supersecretvalue123'), 'environment secrets are redacted');
    const r3 = st.record({ ...base, action: 'x'.repeat(500) + '\nsecond line' });
    assert.strictEqual(r3!.action.length, 160, 'action cut to 160');
    assert.ok(!/[\r\n]/.test(r3!.action));
  }

  // the cap: at most 5000 rows, newest kept; list is newest first
  {
    assert.strictEqual(ACTIVITY_MAX_ROWS, 5000);
    const st = new ActivityStore(path.join(dir, 'cap.json'), { ...noTimer, env: {} });
    for (let i = 0; i < ACTIVITY_MAX_ROWS + 25; i++) st.record({ ...base, action: `n${i}` });
    const all = st.all();
    assert.strictEqual(all.length, 5000, 'capped at 5000');
    assert.strictEqual(all[0].action, 'n25', 'oldest dropped first');
    assert.strictEqual(st.list(3).map((r) => r.action).join(','), `n5024,n5023,n5022`, 'newest first');
    st.flush();
    const back = new ActivityStore(path.join(dir, 'cap.json'), { ...noTimer, env: {}, max: 100 });
    back.load();
    assert.strictEqual(back.all().length, 100, 'a smaller cap applies on load too');
    st.clear();
    assert.strictEqual(st.list().length, 0, 'cleared');
    const again = new ActivityStore(path.join(dir, 'cap.json'), { ...noTimer, env: {} });
    again.load();
    assert.strictEqual(again.list().length, 0, 'clear is written at once');
  }

  // a corrupt file is an empty log
  {
    fs.writeFileSync(path.join(dir, 'bad.json'), '{not json');
    const st = new ActivityStore(path.join(dir, 'bad.json'), { ...noTimer, env: {} });
    st.load();
    assert.strictEqual(st.list().length, 0);
  }

  // CSV: quotes, commas and line breaks are escaped; formulas are neutralised
  {
    assert.strictEqual(csvCell('plain'), 'plain');
    assert.strictEqual(csvCell('a,b'), '"a,b"');
    assert.strictEqual(csvCell('say "hi"'), '"say ""hi"""');
    assert.strictEqual(csvCell('|cmd'), "'|cmd"); assert.strictEqual(csvCell('%PATH%'), "'%PATH%"); // security review 2026-10-20
    assert.strictEqual(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
    for (const c of ['=', '+', '-', '@']) assert.strictEqual(csvCell(`${c}1+1`)[0], "'", `formula guard for ${c}`);
    assert.strictEqual(csvCell('\tx')[0], "'");
    const rows: ActivityRow[] = [{ t: '2026-10-20T10:00:00.000Z', agent: '=cmd|"/c calc"!A1', folder: 'f', app: 'GitHub Copilot', mode: 'ask', action: '@SUM(1,2)', decision: 'denied' }];
    const csv = activityCsv(rows);
    const lines = csv.trimEnd().split('\r\n');
    assert.strictEqual(lines[0], 't,agent,folder,app,mode,action,decision');
    assert.strictEqual(lines[1], `2026-10-20T10:00:00.000Z,"'=cmd|""/c calc""!A1",f,GitHub Copilot,ask,"'@SUM(1,2)",denied`);
    const json = JSON.parse(activityJson(rows)) as ActivityRow[];
    assert.deepStrictEqual(Object.keys(json[0]), [...ACTIVITY_FIELDS]);
  }

  // spec 006 FR-031: a deleted session is a row with ids and a date, never a title; CSV and JSON carry it like any row
  {
    const st = new ActivityStore(path.join(dir, 'd.json'), { ...noTimer, env: {} });
    const r = st.record({ agent: 'web-shop', folder: 'web-shop', app: 'GitHub Copilot', mode: 'read-only', action: 'Session deleted · GitHub Copilot · a1b2c3d4 · last used 2026-10-18', decision: 'session-deleted' });
    assert.ok(r && r.decision === 'session-deleted', 'the new decision is accepted');
    assert.ok(activityCsv(st.all()).includes('session-deleted') && (JSON.parse(activityJson(st.all())) as ActivityRow[])[0].decision === 'session-deleted');
  }

  // decisions from final permission answers
  {
    assert.strictEqual(decisionOf({ state: 'pending' }), undefined);
    assert.strictEqual(decisionOf({ state: 'approved', via: 'user' }), 'allowed-once');
    assert.strictEqual(decisionOf({ state: 'approved', via: 'user', remembered: true }), 'allowed-session');
    assert.strictEqual(decisionOf({ state: 'denied', via: 'user' }), 'denied');
    assert.strictEqual(decisionOf({ state: 'approved', via: 'session' }), 'auto-session-grant');
    assert.strictEqual(decisionOf({ state: 'approved', via: 'policy' }), 'auto-allow-all');
    assert.strictEqual(decisionOf({ state: 'denied', via: 'stopped' }), undefined, 'a stopped session is not a decision');
    assert.strictEqual(decisionOf({ state: 'denied' }), undefined, 'a Read-only denial is not logged');
  }

  // mode and limit changes are logged by main's own ops
  void (async () => {
    const logged: Array<[string, string]> = [];
    const a = { id: 's1', name: 'web-shop', cwd: '/w/web-shop', folders: [], permMode: 'read-only', adapterId: 'copilot' } as unknown as AgentInfo;
    const ad = { isLive: () => false, setPermMode: () => ({ pending: 0 }), capabilities: { capUnit: 'aiu' } };
    const d: OpsDeps = { agents: new Map([[a.id, a]]), router: { forAgent: () => ad as never }, wsKey: (x) => x.cwd, log: (_a, dec, action) => logged.push([dec, action]) };
    assert.ok(setModeOp(d, 's1', 'ask', {}).ok);
    assert.deepStrictEqual(logged[0], ['mode-change', 'Read-only to Ask first']);
    assert.ok((await setCapOp(d, 's1', 120)).ok);
    assert.deepStrictEqual(logged[1], ['limit-change', 'Spending limit set to 120 AI credits']);
    assert.ok((await setCapOp(d, 's1', null)).ok);
    assert.deepStrictEqual(logged[2], ['limit-change', 'Spending limit removed']);
    assert.ok(!(await setCapOp(d, 's1', 5)).ok);
    assert.strictEqual(logged.length, 3, 'a refused change is not logged');

    // the table: every value escaped, plain words for decisions, empty state
    const esc = (s: string): string => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
    assert.ok(T.tableHtml([], esc).includes(T.EMPTY));
    assert.strictEqual(T.EMPTY, 'Nothing yet. Answers to permission requests appear here.');
    assert.strictEqual(T.NOTE, 'Kept on this computer. Actions and decisions only; never prompts, replies or file contents.');
    const html = T.tableHtml([{ t: '2026-10-20T10:00:00Z', agent: '<img src=x onerror=alert(1)>', folder: 'f', app: 'a', mode: 'allow', action: '"><script>', decision: 'auto-allow-all' }], esc);
    assert.ok(!html.includes('<img') && !html.includes('<script>'), 'escaped');
    assert.ok(html.includes('Automatic (Allow all)') && html.includes('Allow all'));
    assert.deepStrictEqual(Object.values(T.DECISION_WORDS), ['Allowed once by you', 'Allowed for the session', 'Denied', 'Automatic (Allow all)', 'Automatic (session permission)', 'Mode changed', 'Limit changed', 'Remote control on', 'Remote control off', 'Session deleted', 'MCP restart', 'Loop started', 'Loop pass', 'Loop pass skipped', 'Loop on hold', 'Loop ended']);
    assert.deepStrictEqual(Object.keys(T.DECISION_WORDS), [...ACTIVITY_DECISIONS], 'one plain word per decision, in the same order');

    // spec 072 FR-024 (T008): the loop rows main records, through the store: kept, redacted, never the prompt or the reply
    {
      const st = new ActivityStore(path.join(dir, 'loops.json'), { ...noTimer, env: {} });
      const L = { minDelay: 5, maxDelay: 60, defaultDelay: 30, maxPasses: 12, endAt: 1 };
      const tok = 'ghp_' + 'B'.repeat(36);
      const notes: LoopNote[] = [{ kind: 'start' }, { kind: 'sent', pass: 1 }, { kind: 'pass', pass: 1, next: 1, minutes: 25, reason: `waiting for CI ${tok}`, source: 'agent' }, { kind: 'skip', why: 'busy' }, { kind: 'hold', why: 'person' }, { kind: 'end', reason: 'agent', text: `Stopped by the agent: merged ${tok}` }];
      for (const n of notes) {
        const r = loopActivity(n, { loop: L, cap: { amount: 50, unit: 'aiu' } });
        if (r) assert.ok(st.record({ agent: 'Ana', folder: '/home/u/w', app: 'GitHub Copilot', mode: 'read-only', action: r.action, decision: r.decision, prompt: 'the loop prompt' }));
      }
      const got = st.list();
      assert.deepStrictEqual(got.map((r) => r.decision).sort(), ['loop-end', 'loop-hold', 'loop-pass', 'loop-skip', 'loop-start'].sort(), 'one row per start, pass, skip, hold and end; a pass that only went out has none');
      assert.ok(got.every((r) => r.mode === 'read-only'), 'the session\'s own mode');
      const text = JSON.stringify(got);
      assert.ok(!text.includes('BBBBBBBB') && !text.includes('the loop prompt'), 'redacted, and no prompt');
      assert.ok(got.some((r) => r.decision === 'loop-pass' && r.action.startsWith('Loop pass 1 of 12 · next in 25 min: waiting for CI')));
      assert.ok(T.tableHtml(got, esc).includes('Loop pass skipped'), 'the table words the loop decisions');
    }

    // issue #973: the export is the notes export's atomic, no-follow write (main's own handler on a stand-in `electron`, a fake save dialog)
    {
      const electronPath = require.resolve('electron');
      let pick: string | undefined;
      let lastOpts: unknown;
      const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
      const fake = { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined }, app: { getVersion: () => '0.0.0-test' }, dialog: { showSaveDialog: async (o: unknown) => { lastOpts = o; return pick ? { canceled: false, filePath: pick } : { canceled: true }; } } };
      const saved = require.cache[electronPath];
      require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
      const out = fs.realpathSync(fs.mkdtempSync(path.join(dir, 'exp-')));
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { register } = require('../src/main/ipc/activity') as typeof import('../src/main/ipc/activity');
        const st = new ActivityStore(path.join(out, 'activity.json'), { ...noTimer, env: {} });
        st.record({ ...base });
        register({ getActivityStore: () => st, getWin: () => undefined });
        const frame = { url: require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
        const win = { senderFrame: frame, sender: { mainFrame: frame } };
        const exp = async (to: string, fmt = 'csv'): Promise<Record<string, unknown>> => { pick = to; return (await handlers.get('activity:export')!(win, fmt)) as Record<string, unknown>; };
        const leftovers = (d: string): string[] => fs.readdirSync(d).filter((n) => n.endsWith('.tmp'));
        const posix = process.platform !== 'win32';
        // a new file: exact content, 0600 where modes apply, no temp file left
        const f1 = path.join(out, 'a.csv');
        assert.deepStrictEqual(await exp(f1), { ok: true, count: 1, to: 'a.csv' });
        assert.strictEqual(fs.readFileSync(f1, 'utf8'), activityCsv(st.all()));
        if (posix) assert.strictEqual(fs.statSync(f1).mode & 0o777, 0o600, 'mode 0600');
        assert.deepStrictEqual(leftovers(out), []);
        // the Linux dialog asks before replacing a file, as the notes export's does (Windows and macOS always ask)
        assert.ok(((lastOpts as { properties?: string[] }).properties ?? []).includes('showOverwriteConfirmation'), 'the save dialog asks before replacing');
        // a plain file is replaced; a bad format and a cancelled dialog write nothing
        assert.strictEqual((await exp(f1, 'json')).ok, true);
        assert.strictEqual(JSON.parse(fs.readFileSync(f1, 'utf8')).length, 1, 'replaced');
        assert.strictEqual((await exp(path.join(out, 'b.csv'), 'xml')).ok, false);
        pick = undefined;
        assert.strictEqual(((await handlers.get('activity:export')!(win, 'csv')) as { cancelled?: boolean }).cancelled, true);
        // the size cap and the word in the refusal: above `maxBytes` is refused, says "activity" (not "notes") and writes nothing
        {
          const { ACTIVITY_EXPORT_MAX_BYTES } = require('../src/main/ipc/activity') as typeof import('../src/main/ipc/activity');
          const big = { ...base, t: '2026-10-20T10:00:00Z' };
          handlers.clear();
          register({ getActivityStore: () => ({ all: () => [{ ...big, action: 'x'.repeat(ACTIVITY_EXPORT_MAX_BYTES + 100) }], list: () => [], clear: () => undefined }) as unknown as ActivityStore, getWin: () => undefined });
          const f2 = path.join(out, 'big.json');
          const r = await exp(f2, 'json');
          assert.strictEqual(r.ok, false, 'over the cap: refused');
          assert.match(String(r.error), /^Could not export the activity: .*too large/, 'the refusal says activity, not notes');
          assert.ok(!fs.existsSync(f2), 'nothing written');
          // just under the cap works through the handler, above the notes' own limit (about 14.8 MB): without `maxBytes` the notes default would refuse it
          {
            const { NOTES_LIMITS } = require('../src/shared/notes') as typeof import('../src/shared/notes');
            handlers.clear();
            register({ getActivityStore: () => ({ all: () => [{ ...big, action: 'x'.repeat(15 * 1024 * 1024) }], list: () => [], clear: () => undefined }) as unknown as ActivityStore, getWin: () => undefined });
            const f3 = path.join(out, 'under.json');
            const u = await exp(f3, 'json');
            assert.deepStrictEqual([u.ok, u.count], [true, 1], 'between the notes limit and the cap: written');
            assert.ok(fs.statSync(f3).size > NOTES_LIMITS.mdBytes && fs.statSync(f3).size < ACTIVITY_EXPORT_MAX_BYTES, 'the file is above the notes limit and under the activity cap');
            fs.rmSync(f3);
          }
          // the cap is not self-referential: the worst possible full log, 5000 rows through the real store with every field at its cap and
          // the costliest characters (a lone surrogate is 6 bytes in JSON; a quote is doubled in CSV), is under it in both formats and exports
          for (const ch of ['\ud800', '"', '\u20ac']) {
            const wst = new ActivityStore(path.join(out, 'worst.json'), { ...noTimer, env: {} });
            const w = { ...base, agent: ch.repeat(80), folder: ch.repeat(80), app: ch.repeat(80), mode: ch.repeat(16), action: ch.repeat(160), t: '2026-10-20T10:00:00Z' };
            for (let i = 0; i < ACTIVITY_MAX_ROWS + 5; i++) wst.record({ ...w });
            const all = wst.all();
            assert.strictEqual(all.length, ACTIVITY_MAX_ROWS, 'the real store holds the newest 5000');
            assert.strictEqual(all[0].action.length, 160, 'the action is at its cap');
            const sizes = [Buffer.byteLength(activityCsv(all)), Buffer.byteLength(activityJson(all))];
            assert.ok(Math.max(...sizes) < ACTIVITY_EXPORT_MAX_BYTES, `worst-case log (${JSON.stringify(ch)}) ${sizes.join('/')} bytes is under the cap ${ACTIVITY_EXPORT_MAX_BYTES}`);
            assert.ok(Math.max(...sizes) > 1024 * 1024, 'and it is a real, large log (not a tiny test row)');
            handlers.clear();
            register({ getActivityStore: () => wst, getWin: () => undefined });
            for (const [fmt, ext] of [['csv', 'csv'], ['json', 'json']] as const) {
              const ok = await exp(path.join(out, 'worst.' + ext), fmt);
              assert.deepStrictEqual([ok.ok, ok.count], [true, ACTIVITY_MAX_ROWS], 'the worst-case log exports in ' + fmt);
              fs.rmSync(path.join(out, 'worst.' + ext));
            }
            fs.rmSync(path.join(out, 'worst.json'), { force: true });
          }
          handlers.clear();
          register({ getActivityStore: () => st, getWin: () => undefined });
        }
        // a link at the chosen name is refused and the file it points to is not touched
        const victim = path.join(out, 'victim.txt');
        fs.writeFileSync(victim, 'keep me');
        let linked = true;
        const lnk = path.join(out, 'link.csv');
        try { fs.symlinkSync(victim, lnk, 'file'); } catch { linked = false; }
        if (linked) {
          const r = await exp(lnk);
          assert.strictEqual(r.ok, false);
          assert.match(String(r.error), /^Could not export the activity: .*the chosen file is a link/);
          assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'keep me', 'the link target is untouched');
          assert.ok(fs.lstatSync(lnk).isSymbolicLink(), 'the link is still a link');
        } else console.log('skip: symlinks are not allowed here');
        // a hard link is refused (it would write through to the other name)
        const hard = path.join(out, 'hard.csv');
        let hardOk = true;
        try { fs.linkSync(victim, hard); } catch { hardOk = false; }
        if (hardOk) {
          assert.match(String((await exp(hard)).error), /^Could not export the activity: .*hard link/);
          assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'keep me');
        } else console.log('skip: hard links are not allowed here');
        // a folder, a missing folder and a FIFO
        assert.match(String((await exp(out)).error), /^Could not export the activity: .*(chosen name is a folder|is not a regular file)/);
        assert.match(String((await exp(path.join(out, 'nope', 'x.csv'))).error), /^Could not export the activity: .*chosen folder is not there/);
        if (posix) {
          const fifo = path.join(out, 'pipe.csv');
          if (require('child_process').spawnSync('mkfifo', [fifo], { stdio: 'ignore' }).status === 0) assert.match(String((await exp(fifo)).error), /^Could not export the activity: .*not a regular file/);
          else console.log('skip: mkfifo is not available');
        } else console.log('skip: FIFOs are POSIX only');
        // the toast shows the reason as main wrote it, with no second prefix (the notes export does the same)
        const scr = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'screens.js'), 'utf8');
        const fn = scr.slice(scr.indexOf('async function exportActivity'), scr.indexOf('async function clearActivity'));
        assert.ok(fn.includes("esc((r&&r.error)||") && !/Could not save the activity log/.test(fn), 'exportActivity shows r.error alone');
        assert.deepStrictEqual(leftovers(out), [], 'no temp file after a refusal');
      } finally {
        if (saved) require.cache[electronPath] = saved;
        else delete require.cache[electronPath];
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('activity tests passed');
  })().catch((e) => { console.error(e); process.exit(1); });
} catch (e) {
  fs.rmSync(dir, { recursive: true, force: true });
  throw e;
}
