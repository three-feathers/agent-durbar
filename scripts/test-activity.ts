/** Activity log (spec 052 FR-071): store cap, redaction, CSV escaping and formula-injection guard, only the listed fields. `npm run test:activity`. No credits spent. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ActivityStore } from '../src/main/activitystore';
import { ACTIVITY_FIELDS, ACTIVITY_MAX_ROWS, activityCsv, activityJson, csvCell, decisionOf, sanitizeActivityRow } from '../src/shared/activity';
import type { ActivityRow } from '../src/shared/activity';
import { setCapOp, setModeOp } from '../src/main/agentops';
import type { OpsDeps } from '../src/main/agentops';
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
    assert.deepStrictEqual(Object.values(T.DECISION_WORDS), ['Allowed once by you', 'Allowed for the session', 'Denied', 'Automatic (Allow all)', 'Automatic (session permission)', 'Mode changed', 'Limit changed', 'Remote control on', 'Remote control off']);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('activity tests passed');
  })().catch((e) => { console.error(e); process.exit(1); });
} catch (e) {
  fs.rmSync(dir, { recursive: true, force: true });
  throw e;
}
