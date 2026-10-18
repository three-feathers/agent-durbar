/**
 * SC-004 parity (spec 012 T026, FR-084): the same scripted "try to write a file" case goes through each kind's own mode
 * mapping and must give the same normalised outcome: Read-only denies, Ask first holds for the user, Allow all approves,
 * a read inside the workspace is approved everywhere, an unknown mode behaves as Read-only.
 *  - copilot: `PermissionBroker` (the decision Copilot's permission handler delegates to).
 *  - claude:  `claudeModes` (`claudeOptionsFor`, `decideTool`, `preToolUseDecision`).
 *  - codex:   `codexModes` (`codexModeSettings`, `codexPermission`, `codexReply`).
 * Pure functions and the broker only: no session, no process, no credits. A case a mapping cannot express is printed as
 * `SKIP <kind> <mode> <case>: <reason>` and counted, never passed silently. `npm run test:runtime`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PermissionBroker, startModeOf } from '../src/adapters/permissions';
import type { BrokerEvent } from '../src/adapters/permissions';
import { claudeOptionsFor, decideTool, preToolUseDecision } from '../src/adapters/claudeModes';
import { CODEX_RO_FILESYSTEM, codexModeSettings, codexPermission, codexReply, codexWorkspaceRoots } from '../src/adapters/codexModes';
import type { PermissionMode } from '../src/adapters/capabilities';

type Outcome = 'deny' | 'ask' | 'approve';
type Kind = 'copilot' | 'claude' | 'codex';
type CaseName = 'write-inside' | 'write-outside' | 'shell' | 'read-inside' | 'read-outside';

const KINDS: Kind[] = ['copilot', 'claude', 'codex'];
const MODES = ['read-only', 'ask', 'allow', 'bogus'];
const CASES: CaseName[] = ['write-inside', 'write-outside', 'shell', 'read-inside', 'read-outside'];

/** FR-084. An unknown mode is Read-only. */
function expected(mode: string, c: CaseName): Outcome {
  if (c === 'read-inside') return 'approve';
  if (mode === 'allow') return 'approve';
  if (mode === 'ask') return 'ask';
  return 'deny';
}

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-sc004-ws-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-sc004-out-'));
const inFile = path.join(ws, 'a.txt');
const outFile = path.join(outside, 'b.txt');
const CMD = 'touch a.txt';

const skipped: string[] = [];
const stricterCells: string[] = [];
let asserted = 0;

/** Copilot: one broker per request, in the given mode, with the session's roots. */
async function copilot(mode: string, c: CaseName): Promise<Outcome> {
  const events: BrokerEvent[] = [];
  const broker = new PermissionBroker({ mode: startModeOf({ permissionMode: mode as PermissionMode }), roots: [ws], emit: (e) => events.push(e) });
  const req =
    c === 'write-inside' ? { kind: 'write', toolCallId: 'c1', fileName: inFile }
    : c === 'write-outside' ? { kind: 'write', toolCallId: 'c1', fileName: outFile }
    : c === 'shell' ? { kind: 'shell', toolCallId: 'c1', fullCommandText: CMD }
    : c === 'read-outside' ? { kind: 'read', toolCallId: 'c1', path: outFile }
    : { kind: 'read', toolCallId: 'c1', path: inFile };
  const p = broker.request(req);
  const pending = broker.pendingCount();
  if (pending > 0) {
    assert.strictEqual(events.some((e) => e.type === 'pending'), true, `copilot ${mode} ${c}: a pending request emits a pending event`);
    broker.stop();
    assert.strictEqual((await p).kind, 'reject', `copilot ${mode} ${c}: stop denies the held request`);
    return 'ask';
  }
  const d = await p;
  if (d.kind === 'approve-once') {
    assert.strictEqual(events.some((e) => e.type === 'denied-policy'), false, `copilot ${mode} ${c}: an approval is not a policy denial`);
    return 'approve';
  }
  assert.ok(events.some((e) => e.type === 'denied-policy'), `copilot ${mode} ${c}: a denial is reported as denied-policy`);
  assert.strictEqual(broker.pendingCount(), 0, `copilot ${mode} ${c}: a denial leaves no pending state`);
  return 'deny';
}

/** Claude: `decideTool` is the decision; the options and the Read-only hook must agree with it. */
function claude(mode: string, c: CaseName): Outcome {
  const m = mode as PermissionMode;
  const isRead = c === 'read-inside' || c === 'read-outside';
  const tool = c === 'shell' ? 'Bash' : isRead ? 'Read' : 'Write';
  const input = c === 'shell' ? { command: CMD } : { file_path: c === 'write-outside' || c === 'read-outside' ? outFile : inFile };
  const d = decideTool(m, tool, input, [ws]);
  const hook = preToolUseDecision(m, tool, input, [ws]);
  const opts = claudeOptionsFor(m);
  const readOnly = mode !== 'ask' && mode !== 'allow'; // unknown = Read-only
  if (readOnly) {
    assert.strictEqual(opts.permissionMode, 'dontAsk', `claude ${mode} ${c}: Read-only options use dontAsk`);
    assert.strictEqual(opts.preToolUseHook, true, `claude ${mode} ${c}: Read-only installs the deny hook`);
    assert.strictEqual(hook !== undefined, d.behavior === 'deny', `claude ${mode} ${c}: the hook denies exactly what decideTool denies`);
    if (!isRead) assert.ok(opts.disallowedTools?.includes(tool), `claude ${mode} ${c}: the Read-only backstop disallows ${tool}`);
  } else {
    assert.strictEqual(hook, undefined, `claude ${mode} ${c}: no hook decision outside Read-only`);
    assert.strictEqual(opts.preToolUseHook, false, `claude ${mode} ${c}: no deny hook outside Read-only`);
    assert.strictEqual(opts.permissionMode, mode === 'ask' ? 'default' : 'bypassPermissions', `claude ${mode} ${c}: the SDK mode`);
    if (mode === 'ask') assert.strictEqual(opts.canUseTool, true, `claude ask ${c}: canUseTool is installed`);
  }
  return d.behavior === 'allow' ? 'approve' : d.behavior;
}

/**
 * Codex: the settings decide who answers. `never` + `read-only` sandbox: nothing runs and nothing is asked (deny);
 * `on-request`: the app-server sends an approval request that Durbar holds (ask); `never` + full access: runs (approve).
 * The write/shell enforcement itself is Codex's sandbox (not run here), so this is the settings' outcome.
 */
function codex(mode: string, c: CaseName): Outcome {
  const s = codexModeSettings(mode);
  if (c === 'read-inside' || c === 'read-outside') {
    // Reads (FR-088, settings level, not run): Codex sends no read approval, so the profile decides. In Read-only and
    // Ask first there is no `sandbox` key (it would replace the profile), the profile has no `:root` and no write
    // entry, and the readable roots are the session's folders. Inside is readable; outside is unreadable.
    if (s.permissions === undefined) {
      assert.strictEqual(s.sandbox, 'danger-full-access', `codex ${mode} ${c}: Allow all reads anywhere`);
      assert.strictEqual(s.approvalPolicy, 'never', `codex ${mode} ${c}: Allow all never asks`);
      return 'approve';
    }
    assert.ok(!('sandbox' in s), `codex ${mode} ${c}: no sandbox key next to the profile`);
    assert.strictEqual(s.permissions, 'durbar_ro', `codex ${mode} ${c}: the read-limited profile`);
    assert.deepStrictEqual(Object.keys(CODEX_RO_FILESYSTEM).sort(), [':minimal', ':workspace_roots'], `codex ${mode} ${c}: the profile reads :minimal and the workspace roots only`);
    assert.ok(!(':root' in CODEX_RO_FILESYSTEM), `codex ${mode} ${c}: no :root`);
    assert.ok(Object.values(CODEX_RO_FILESYSTEM).every((v) => v === 'read'), `codex ${mode} ${c}: no write or deny entry`);
    assert.deepStrictEqual(codexWorkspaceRoots([ws], (x) => x), [ws], `codex ${mode} ${c}: runtimeWorkspaceRoots equal the session roots`);
    assert.strictEqual(path.resolve(ws) === ws && path.relative(ws, c === 'read-inside' ? inFile : outFile).startsWith('..'), c === 'read-outside', `codex ${mode} ${c}: the file is inside or outside the root`);
    return c === 'read-inside' ? 'approve' : 'deny';
  }
  const perm =
    c === 'shell' ? codexPermission('item/commandExecution/requestApproval', { command: CMD })
    : codexPermission('item/fileChange/requestApproval', { changes: [{ path: c === 'write-outside' ? outFile : inFile }] });
  assert.strictEqual(perm.kind, c === 'shell' ? 'shell' : 'write', `codex ${mode} ${c}: the request maps to its kind`);
  if (s.approvalPolicy === 'on-request') {
    assert.strictEqual(s.permissions, 'durbar_ro', `codex ${mode} ${c}: Ask first keeps the read-limited profile`);
    assert.ok(!('sandbox' in s), `codex ${mode} ${c}: Ask first sends no sandbox key`);
    assert.strictEqual(codexReply('approve', mode).decision, 'accept', `codex ${mode} ${c}: approving a held request accepts`);
    assert.strictEqual(codexReply('deny', mode).decision, 'decline', `codex ${mode} ${c}: denying a held request declines`);
    return 'ask';
  }
  if (s.sandbox === 'danger-full-access') {
    assert.strictEqual(s.approvalPolicy, 'never', `codex ${mode} ${c}: Allow all never asks`);
    return 'approve';
  }
  // never + read-limited profile: a stray request is still declined
  assert.strictEqual(codexReply('approve', mode).decision, 'decline', `codex ${mode} ${c}: a stray request is declined, never accepted`);
  return 'deny';
}

const table: string[] = [];
async function main(): Promise<void> {
  for (const kind of KINDS) {
    for (const mode of MODES) {
      for (const c of CASES) {
        const got = kind === 'copilot' ? await copilot(mode, c) : kind === 'claude' ? claude(mode, c) : codex(mode, c);
        // Codex Ask first, read outside: the profile makes the file unreadable (deny), it cannot hold a read for the user.
        // Stricter than the spec's "ask", never weaker; the only such cell, and it is named here and in spec 012 FR-088.
        const stricter = kind === 'codex' && mode === 'ask' && c === 'read-outside';
        if (stricter) stricterCells.push(`${kind} ${mode} ${c}`);
        const want = stricter ? 'deny' : expected(mode, c);
        assert.strictEqual(got, want, `SC-004: ${kind} in ${mode} gave ${got} for ${c}, expected ${want}`);
        asserted++;
        table.push(`${kind} ${mode} ${c} = ${got}`);
      }
    }
  }
  const total = KINDS.length * MODES.length * CASES.length;
  assert.strictEqual(asserted + skipped.length, total, 'every kind x mode x case is asserted or listed as SKIP');
  assert.strictEqual(skipped.length, 0, 'no SKIPs: the Codex read cells are asserted at the settings level (FR-088)');
  assert.deepStrictEqual(stricterCells, ['codex ask read-outside'], 'exactly one cell is stricter than the contract, by name');
  assert.strictEqual(asserted, 60, 'all 60 cells asserted');
  assert.strictEqual(total, 60, '3 kinds x 4 modes x 5 cases = 60 cells');
  console.log(table.join('\n'));
  console.log(`sc004: ${asserted} asserted, ${skipped.length} skipped (listed above), ${total} cells`);
}

main()
  .then(() => console.log('sc004: ok'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
