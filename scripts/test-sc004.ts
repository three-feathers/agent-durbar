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
import { codexModeSettings, codexPermission, codexReply } from '../src/adapters/codexModes';
import type { PermissionMode } from '../src/adapters/capabilities';

type Outcome = 'deny' | 'ask' | 'approve';
type Kind = 'copilot' | 'claude' | 'codex';
type CaseName = 'write-inside' | 'write-outside' | 'shell' | 'read-inside';

const KINDS: Kind[] = ['copilot', 'claude', 'codex'];
const MODES = ['read-only', 'ask', 'allow', 'bogus'];
const CASES: CaseName[] = ['write-inside', 'write-outside', 'shell', 'read-inside'];

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
let asserted = 0;

/** Copilot: one broker per request, in the given mode, with the session's roots. */
async function copilot(mode: string, c: CaseName): Promise<Outcome> {
  const events: BrokerEvent[] = [];
  const broker = new PermissionBroker({ mode: startModeOf({ permissionMode: mode as PermissionMode }), roots: [ws], emit: (e) => events.push(e) });
  const req =
    c === 'write-inside' ? { kind: 'write', toolCallId: 'c1', fileName: inFile }
    : c === 'write-outside' ? { kind: 'write', toolCallId: 'c1', fileName: outFile }
    : c === 'shell' ? { kind: 'shell', toolCallId: 'c1', fullCommandText: CMD }
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
  const tool = c === 'shell' ? 'Bash' : c === 'read-inside' ? 'Read' : 'Write';
  const input = c === 'shell' ? { command: CMD } : { file_path: c === 'write-outside' ? outFile : inFile };
  const d = decideTool(m, tool, input, [ws]);
  const hook = preToolUseDecision(m, tool, input, [ws]);
  const opts = claudeOptionsFor(m);
  const readOnly = mode !== 'ask' && mode !== 'allow'; // unknown = Read-only
  if (readOnly) {
    assert.strictEqual(opts.permissionMode, 'dontAsk', `claude ${mode} ${c}: Read-only options use dontAsk`);
    assert.strictEqual(opts.preToolUseHook, true, `claude ${mode} ${c}: Read-only installs the deny hook`);
    assert.strictEqual(hook !== undefined, d.behavior === 'deny', `claude ${mode} ${c}: the hook denies exactly what decideTool denies`);
    if (c !== 'read-inside') assert.ok(opts.disallowedTools?.includes(tool), `claude ${mode} ${c}: the Read-only backstop disallows ${tool}`);
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
function codex(mode: string, c: CaseName): Outcome | 'skip' {
  if (c === 'read-inside') return 'skip'; // Codex never asks for a read (CodexPermission.kind is never read); the sandbox allows it
  const s = codexModeSettings(mode);
  const perm =
    c === 'shell' ? codexPermission('item/commandExecution/requestApproval', { command: CMD })
    : codexPermission('item/fileChange/requestApproval', { changes: [{ path: c === 'write-outside' ? outFile : inFile }] });
  assert.strictEqual(perm.kind, c === 'shell' ? 'shell' : 'write', `codex ${mode} ${c}: the request maps to its kind`);
  if (s.approvalPolicy === 'on-request') {
    assert.strictEqual(s.sandbox, 'read-only', `codex ${mode} ${c}: Ask first keeps the read-only sandbox`);
    assert.strictEqual(codexReply('approve', mode).decision, 'accept', `codex ${mode} ${c}: approving a held request accepts`);
    assert.strictEqual(codexReply('deny', mode).decision, 'decline', `codex ${mode} ${c}: denying a held request declines`);
    return 'ask';
  }
  if (s.sandbox === 'danger-full-access') {
    assert.strictEqual(s.approvalPolicy, 'never', `codex ${mode} ${c}: Allow all never asks`);
    return 'approve';
  }
  // never + read-only sandbox: a stray request is still declined
  assert.strictEqual(codexReply('approve', mode).decision, 'decline', `codex ${mode} ${c}: a stray request is declined, never accepted`);
  return 'deny';
}

const table: string[] = [];
async function main(): Promise<void> {
  for (const kind of KINDS) {
    for (const mode of MODES) {
      for (const c of CASES) {
        const got = kind === 'copilot' ? await copilot(mode, c) : kind === 'claude' ? claude(mode, c) : codex(mode, c);
        if (got === 'skip') {
          const line = `SKIP ${kind} ${mode} ${c}: Codex sends no approval request for a read (its kind is never read); the read-only or full-access sandbox decides, and that is not run here`;
          skipped.push(line);
          console.log(line);
          table.push(`${kind} ${mode} ${c} = SKIP`);
          continue;
        }
        assert.strictEqual(got, expected(mode, c), `SC-004: ${kind} in ${mode} gave ${got} for ${c}, expected ${expected(mode, c)}`);
        asserted++;
        table.push(`${kind} ${mode} ${c} = ${got}`);
      }
    }
  }
  const total = KINDS.length * MODES.length * CASES.length;
  assert.strictEqual(asserted + skipped.length, total, 'every kind x mode x case is asserted or listed as SKIP');
  assert.strictEqual(skipped.length, MODES.length, 'only the Codex read-inside case is skipped, once per mode');
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
