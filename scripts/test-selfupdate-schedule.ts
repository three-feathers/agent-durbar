/**
 * Spec 118 T006 (FR-004, FR-005, FR-016, FR-021, SC-001): when Durbar may contact its source, on a simulated clock, and snooze and
 * skip. `npm run test:selfupdate-schedule`. Pure: the "requests" are counted calls of `cadenceDue`, no timer, no network.
 */
import * as assert from 'assert';
import { cadenceDue, manualCheckAllowed, selfCheckOn, selfPolicyView, snoozeState, DAY_MS, SNOOZE_MS } from '../src/shared/selfupdate';
import type { CadenceInput } from '../src/shared/selfupdate';

const T0 = Date.UTC(2026, 10, 22);
const ci = (o: Partial<CadenceInput> = {}): CadenceInput => ({ now: T0, packaged: true, simulator: false, origin: 'ci', selfCheck: undefined, policy: { state: 'none' }, lastCheckAt: undefined, ...o });

// Default and switch (D2 = A; FR-001 origin; FR-021 bad values are absent)
assert.strictEqual(selfCheckOn(ci()), true, 'on by default (D2)');
assert.strictEqual(selfCheckOn(ci({ origin: 'env' })), true, 'an env-baked build is on by default');
assert.strictEqual(selfCheckOn(ci({ origin: 'local' })), false, 'a local build is off by default');
assert.strictEqual(selfCheckOn(ci({ origin: 'local', selfCheck: true })), true, 'a local build can be turned on');
assert.strictEqual(selfCheckOn(ci({ selfCheck: false })), false, 'the switch turns it off');
assert.strictEqual(selfCheckOn(ci({ selfCheck: 'false' })), true, 'a non-boolean switch is ignored (default)');
assert.strictEqual(selfCheckOn(ci({ origin: undefined, selfCheck: true })), false, 'no baked source, no check');
assert.strictEqual(selfCheckOn(ci({ packaged: false, selfCheck: true })), false, 'a dev run never checks');
assert.strictEqual(selfCheckOn(ci({ simulator: true, selfCheck: true })), false, 'the simulator never checks');

// Policy (FR-005)
assert.strictEqual(selfCheckOn(ci({ policy: { state: 'ok', updatesMode: 'off' } })), false, 'updates.mode off stops it');
assert.strictEqual(selfCheckOn(ci({ policy: { state: 'unreadable' } })), false, 'an unreadable policy fails closed');
assert.strictEqual(selfCheckOn(ci({ policy: undefined })), false, 'a missing policy fails closed (review on PR 2037, item 7)');
assert.strictEqual(manualCheckAllowed(ci({ policy: undefined })), false, 'no Check now without a policy answer');
assert.deepStrictEqual(selfPolicyView({ state: 'later' } as unknown as Parameters<typeof selfPolicyView>[0]), { hidden: true, blocked: true }, 'an unknown policy state fails closed');
assert.strictEqual(selfCheckOn(ci({ policy: { state: 'ok', updatesMode: 'sometimes' } })), false, 'an unknown mode fails closed');
assert.strictEqual(selfCheckOn(ci({ policy: { state: 'ok', updatesMode: 'notify' } })), true, 'notify allows the check');
assert.deepStrictEqual(selfPolicyView({ state: 'ok', feedUrl: 'https://github.com/acme/durbar' }), { hidden: false, blocked: false, feedSlug: 'acme/durbar' }, 'a github.com feedUrl sets the source');
for (const u of ['acme/durbar', 'https://example.com/acme/durbar', 'https://github.com/acme/durbar/releases', 'https://u@github.com/acme/durbar', 42]) {
  assert.strictEqual(selfPolicyView({ state: 'ok', feedUrl: u }).blocked, true, 'an unsupported feedUrl blocks the check: ' + JSON.stringify(u));
}
assert.strictEqual(selfPolicyView({ state: 'ok', updatesMode: 'off' }).hidden, true, 'off hides the section');

// Check now (User Story 6): the switch does not matter, the policy does
assert.strictEqual(manualCheckAllowed(ci({ selfCheck: false })), true, 'Check now works with the switch off');
assert.strictEqual(manualCheckAllowed(ci({ policy: { state: 'ok', updatesMode: 'off' } })), false, 'no Check now when the organization turns it off');
assert.strictEqual(manualCheckAllowed(ci({ simulator: true })), false, 'the simulator never contacts the source');

// Cadence (D5 = B)
assert.deepStrictEqual(cadenceDue(ci()), { due: true, waitMs: DAY_MS }, 'never checked: due at start');
assert.deepStrictEqual(cadenceDue(ci({ lastCheckAt: T0 - DAY_MS + 1000 })), { due: false, waitMs: 1000 }, 'checked under 24 h ago: wait the rest');
assert.strictEqual(cadenceDue(ci({ lastCheckAt: T0 - DAY_MS })).due, true, 'checked 24 h ago: due');
assert.strictEqual(cadenceDue(ci({ lastCheckAt: T0 + DAY_MS })).due, true, 'a last check in the future (clock moved back) is due once');
assert.strictEqual(cadenceDue(ci({ lastCheckAt: 'yesterday' })).due, true, 'a bad last-check value is absent');
assert.deepStrictEqual(cadenceDue(ci({ selfCheck: false })), { due: false }, 'off: not due and nothing to wait for (no timer)');

/** SC-001: a simulated run ticking every 10 minutes; a "request" is each due answer, which then saves the time as the last check. */
function run(o: Partial<CadenceInput>, hours: number, flip?: (now: number) => Partial<CadenceInput>): { calls: number; timers: number } {
  let last: number | undefined;
  let calls = 0;
  let timers = 0;
  for (let now = T0; now <= T0 + hours * 3600_000; now += 600_000) {
    const input = ci({ ...o, ...(flip ? flip(now) : {}), now, lastCheckAt: last });
    const d = cadenceDue(input);
    if (d.waitMs !== undefined) timers++;
    if (d.due) { calls++; last = now; }
  }
  return { calls, timers };
}
assert.deepStrictEqual(run({ selfCheck: false }, 24), { calls: 0, timers: 0 }, 'switch off: zero requests and no timer in 24 h');
assert.deepStrictEqual(run({ policy: { state: 'ok', updatesMode: 'off' } }, 24), { calls: 0, timers: 0 }, 'policy off: zero requests and no timer in 24 h');
assert.strictEqual(run({}, 72).calls, 4, 'on: one request at start and one per 24 h');
assert.strictEqual(run({}, 72, (now) => (now >= T0 + DAY_MS ? { selfCheck: false } : {})).calls, 1, 'turned off after a day: no further request');

// Turned off while a check runs: the answer is discarded (main asks selfCheckOn again when the answer arrives)
const started = ci();
assert.strictEqual(cadenceDue(started).due, true, 'the check starts');
assert.strictEqual(selfCheckOn({ ...started, selfCheck: false }), false, 'switch off mid-check: the answer is not wanted');
assert.strictEqual(selfCheckOn({ ...started, policy: { state: 'ok', updatesMode: 'off' } }), false, 'policy off mid-check: the answer is not wanted');

// Snooze and skip (FR-016)
assert.strictEqual(snoozeState(T0, '0.1.29', undefined, undefined), 'show', 'nothing saved: shown');
assert.strictEqual(snoozeState(T0, '0.1.29', { version: '0.1.29', until: T0 + SNOOZE_MS }), 'snoozed', 'snoozed for 7 days');
assert.strictEqual(snoozeState(T0 + SNOOZE_MS, '0.1.29', { version: '0.1.29', until: T0 + SNOOZE_MS }), 'show', 'shown again after 7 days');
assert.strictEqual(snoozeState(T0, '0.1.30', { version: '0.1.29', until: T0 + SNOOZE_MS }), 'show', 'a newer release ends the snooze');
assert.strictEqual(snoozeState(T0, '0.1.29', { version: '0.1.29', until: T0 + 365 * DAY_MS }), 'show', 'a snooze longer than 7 days is ignored');
assert.strictEqual(snoozeState(T0, '0.1.29', { version: '0.1.29', until: String(T0 + DAY_MS) }), 'show', 'a bad snooze is ignored');
assert.strictEqual(snoozeState(T0, '0.1.29', ['0.1.29', T0 + DAY_MS]), 'show', 'an array snooze is ignored');
assert.strictEqual(snoozeState(T0, '0.1.29', undefined, '0.1.29'), 'skipped', 'a skipped version is hidden');
assert.strictEqual(snoozeState(T0, '0.1.29', undefined, 'v0.1.29'), 'skipped', 'a skip saved with v counts');
assert.strictEqual(snoozeState(T0, '0.1.30', undefined, '0.1.29'), 'show', 'a newer release after a skip is shown');
assert.strictEqual(snoozeState(T0, '0.1.28', undefined, '0.1.29'), 'skipped', 'skip also hides an older version');
assert.strictEqual(snoozeState(T0, '0.1.29', undefined, { version: '0.1.29' }), 'show', 'a bad skip is ignored');
console.log('selfupdate-schedule: ok');
