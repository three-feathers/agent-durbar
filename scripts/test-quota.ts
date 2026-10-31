/**
 * Spec 011 FR-080..FR-094 (issue #690): account quota per agent app. Fakes only; no real account, no credits.
 * Prints "test-quota: OK"; a hang leaves exit code 1 set.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { cleanName } from '../src/shared/account';
import {
  applyQuotaRead, NEAR_PERCENT, QUOTA_BACKOFF_MS, QUOTA_CHECK_MS, QUOTA_NOT_REPORTED, QUOTA_OPEN_MS, QUOTA_STALE_MS, quotaAlternatives, quotaDisplay, quotaLevel, quotaLine, quotaShouldAsk, quotaState,
  quotaText, quotaTimeMs, quotaView, quotaZoneOf, sanitiseQuotaRead,
} from '../src/shared/quota';
import type { QuotaBucket, QuotaRead, QuotaView } from '../src/shared/quota';
import { codexQuota, copilotQuota, quotaFailureOf } from '../src/adapters/quotamap';
import { resetMs } from '../src/adapters/usagelimit';
import { createQuotaCache, quotaCheck, quotaIpcAnswer } from '../src/main/quota';
import { simChannelOpen } from '../src/main/simguard';
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';
import { FakeCodexServer } from './fakes/codex-app-server';
import type { FakeCodexOptions } from './fakes/codex-app-server';
import { CodexAdapter, CODEX_CAPABILITIES } from '../src/adapters/codex';
import { CLAUDE_CAPABILITIES } from '../src/adapters/claude';
import { COPILOT_CAPABILITIES } from '../src/adapters/copilot';
import type { AdapterInfo } from '../src/shared/adapters';

process.exitCode = 1;
const ROOT = path.join(__dirname, '..', '..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const MIN = 60_000;
const TZ = 'UTC';
const okRead = (buckets: unknown[], source = 'src'): QuotaRead => sanitiseQuotaRead({ kind: 'ok', source, buckets }, NOW);
const reqs = (o: Partial<QuotaBucket> = {}): QuotaBucket => ({ id: 'p', label: 'Premium', unit: 'requests', ...o });
const pctB = (o: Partial<QuotaBucket> = {}): QuotaBucket => ({ id: 'w', label: 'Window', unit: 'percent', ...o });
const viewOf = (b: QuotaBucket[], checkedAt = NOW, extra: Partial<QuotaView> = {}): QuotaView => ({ app: 'a', source: 's', checkedAt, buckets: b, ...extra });
const facts = (v: QuotaView, now = NOW, i = 0): Record<string, string> => Object.fromEntries(quotaDisplay(v, now, { tz: TZ }).rows[i].facts.map((f) => [f.label, f.value]));

// ---- FR-082: sanitising: hostile, malformed, unbounded
{
  const bad = [NaN, Infinity, -Infinity, -1, 1e300, '5', null, {}, [], true];
  for (const v of bad) {
    const r = sanitiseQuotaRead({ kind: 'ok', source: 's', buckets: [{ id: 'x', label: 'L', unit: 'requests', used: v, limit: v, remaining: v, usedPercent: v, remainingPercent: v, windowMins: v, resetsAt: 1 }] }, NOW);
    assert.deepStrictEqual(r, { kind: 'failed', failure: 'malformed' }, `a bucket with only ${String(v)} tells nothing`);
    const kept = sanitiseQuotaRead({ kind: 'ok', source: 's', buckets: [{ id: 'x', label: 'L', unit: 'requests', used: 3, limit: v }] }, NOW);
    assert.ok(kept.kind === 'ok' && kept.buckets[0].used === 3 && !('limit' in kept.buckets[0]), `limit ${String(v)} is dropped, the good figure kept`);
  }
  const zero = sanitiseQuotaRead({ kind: 'ok', source: 's', buckets: [{ id: 'x', label: 'L', unit: 'requests', used: 0, limit: 0 }] }, NOW);
  assert.ok(zero.kind === 'ok' && zero.buckets[0].used === 0 && zero.buckets[0].limit === 0, 'a reported 0 stays 0');
  const cap = sanitiseQuotaRead({ kind: 'ok', source: 's', buckets: [{ id: 'x', label: 'L', unit: 'percent', usedPercent: 150 }] }, NOW);
  assert.ok(cap.kind === 'ok' && cap.buckets[0].usedPercent === 100, 'percent capped at 100');
  assert.deepStrictEqual(sanitiseQuotaRead('nope', NOW), { kind: 'failed', failure: 'malformed' });
  assert.deepStrictEqual(sanitiseQuotaRead(null, NOW), { kind: 'failed', failure: 'malformed' });
  assert.deepStrictEqual(sanitiseQuotaRead({ kind: 'ok', buckets: 'x' }, NOW), { kind: 'failed', failure: 'malformed' });
  assert.deepStrictEqual(sanitiseQuotaRead({ kind: 'ok', buckets: [] }, NOW), { kind: 'not-reported', reason: 'none' });
  assert.deepStrictEqual(sanitiseQuotaRead({ kind: 'failed', failure: 'token ghp_abc' }, NOW), { kind: 'failed', failure: 'unavailable' }, 'an unknown kind is never passed on');
  assert.deepStrictEqual(sanitiseQuotaRead({ kind: 'not-reported', reason: '<b>' }, NOW), { kind: 'not-reported', reason: 'none' });
  assert.deepStrictEqual(sanitiseQuotaRead({ kind: 'ok', source: 's', buckets: [{ id: 'x', label: 'L', unit: 'dollars', used: 1 }] }, NOW), { kind: 'failed', failure: 'malformed' }, 'an unknown unit');
  const many = okRead(Array.from({ length: 50 }, (_, i) => ({ id: 'b' + i, label: 'L', unit: 'requests', used: i })));
  assert.ok(many.kind === 'ok' && many.buckets.length === 8, 'at most 8 buckets');
  // an inherited or __proto__ field is not read
  const proto = JSON.parse('{"kind":"ok","source":"s","buckets":[{"__proto__":{"used":9},"id":"x","label":"L","unit":"requests","limit":2}]}');
  const p = sanitiseQuotaRead(proto, NOW);
  assert.ok(p.kind === 'ok' && !('used' in p.buckets[0]) && p.buckets[0].limit === 2 && !({} as Record<string, unknown>).used, 'no prototype pollution');
  // hostile text: one line, no control or bidi characters, bounded; the HTML stays text for the window to escape
  const hostile = '<img src=x onerror=alert(1)>\u202e\u2028\u0007\n' + 'x'.repeat(5000);
  const h = sanitiseQuotaRead({ kind: 'ok', source: hostile, buckets: [{ id: hostile, label: hostile, unit: 'requests', used: 1, resetsAt: NOW + MIN, resetZone: hostile }] }, NOW);
  assert.ok(h.kind === 'ok');
  if (h.kind === 'ok') {
    for (const s of [h.buckets[0].label, h.buckets[0].id, h.buckets[0].resetZone as string, h.source]) {
      assert.ok(s.length <= 120, 'bounded');
      // eslint-disable-next-line no-control-regex
      assert.ok(!/[\u0000-\u001f\u202e\u2028]/.test(s), 'no control or bidi characters');
    }
  }
  // the same character set as the account line (a copy, since this file may import nothing)
  for (const s of ['a\u200bb', 'a\u202eb', 'a\u2066b', 'a\ufeffb', 'a\u0000b', '  x  ', '\u200b', 'ok name']) assert.strictEqual(quotaText(s), cleanName(s, 40), JSON.stringify(s));
  assert.strictEqual(quotaText(5), undefined);
  // reset times: absurd or far away are dropped
  for (const at of [1e300, -5, 'never', NOW + 500 * 86_400_000, NOW - 500 * 86_400_000]) {
    const r = sanitiseQuotaRead({ kind: 'ok', source: 's', buckets: [{ id: 'x', label: 'L', unit: 'requests', used: 1, resetsAt: at }] }, NOW);
    assert.ok(r.kind === 'ok' && !('resetsAt' in r.buckets[0]), `reset ${String(at)} dropped`);
  }
}

// ---- spec 068 keeps its own rule on top of the shared parsing
{
  assert.strictEqual(resetMs(NOW / 1000 + 60, NOW), NOW + 60_000, 'seconds');
  assert.strictEqual(resetMs(NOW - 1, NOW), undefined, 'a past time is unknown for a coffee break');
  assert.strictEqual(resetMs(NOW + 40 * 86_400_000, NOW), undefined, 'over 31 days is unknown for a coffee break');
  assert.strictEqual(quotaTimeMs(String(NOW)), NOW, 'digit strings');
  assert.strictEqual(quotaZoneOf('2026-11-01T00:00:00.000Z'), 'UTC');
  assert.strictEqual(quotaZoneOf('2026-11-01T00:00:00+02:00'), '+02:00');
  assert.strictEqual(quotaZoneOf('2026-11-01'), undefined);
}

// ---- FR-081: vendor shapes
{
  const c = copilotQuota({ quotaSnapshots: {
    chat: { isUnlimitedEntitlement: true, entitlementRequests: -1, usedRequests: 0, remainingPercentage: 100 },
    premium_interactions: { isUnlimitedEntitlement: false, entitlementRequests: 1500, usedRequests: 506, remainingPercentage: 66.3, resetDate: '2026-11-12T00:00:00.000Z', overageAllowedWithExhaustedQuota: true, resetDateEstimated: true },
    weird_kind: { entitlementRequests: 'lots' },
  } });
  const s = sanitiseQuotaRead(c, NOW);
  assert.ok(s.kind === 'ok');
  if (s.kind === 'ok') {
    assert.deepStrictEqual(s.buckets.map((b) => b.id), ['premium_interactions', 'chat'], 'premium first; the one with no usable figure drops out');
    assert.strictEqual(s.buckets[0].label, 'Premium requests');
    assert.deepStrictEqual([s.buckets[0].used, s.buckets[0].limit, s.buckets[0].remainingPercent, s.buckets[0].unit], [506, 1500, 66.3, 'requests']);
    assert.deepStrictEqual([s.buckets[0].resetZone, s.buckets[0].resetEstimated, s.buckets[0].overageAllowed], ['UTC', true, true]);
    assert.ok(s.buckets[1].unlimited && !('limit' in s.buckets[1]) && !('remainingPercent' in s.buckets[1]), 'unlimited: no -1 and no percent');
  }
  assert.deepStrictEqual(copilotQuota({ quotaSnapshots: {} }), { kind: 'not-reported', reason: 'none' });
  for (const m of [null, undefined, 5, 'x', {}, { quotaSnapshots: [] }, { quotaSnapshots: 'x' }]) assert.deepStrictEqual(copilotQuota(m), { kind: 'failed', failure: 'malformed' }, JSON.stringify(m));
  const x = sanitiseQuotaRead(codexQuota({ rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: NOW / 1000 + 60 }, secondary: { usedPercent: 40, windowDurationMins: 10080 }, extra: { usedPercent: 99 } } }), NOW);
  assert.ok(x.kind === 'ok');
  if (x.kind === 'ok') {
    assert.deepStrictEqual(x.buckets.map((b) => [b.label, b.unit, b.usedPercent, b.windowMins]), [['5-hour window', 'percent', 12, 300], ['Weekly window', 'percent', 40, 10080]]);
    assert.strictEqual(x.buckets[0].resetsAt, NOW + 60_000);
    assert.ok(!('resetZone' in x.buckets[0]) && !('limit' in x.buckets[0]), 'Codex gives no zone and no absolute limit: nothing is made up');
  }
  // read: the schema's other fields: an account id and a backend banner never leave the adapter
  const leak = JSON.stringify(codexQuota({ accountId: 'acct-SECRET', rateLimitUpsell: { text: 'UPSELL' }, rateLimits: { planType: 'pro', limitName: 'NAME', credits: { balance: '12' }, primary: { usedPercent: 1 } } }));
  assert.ok(!/SECRET|UPSELL|NAME|balance/.test(leak), leak);
  assert.deepStrictEqual(codexQuota({ rateLimits: { primary: null, secondary: null } }), { kind: 'not-reported', reason: 'none' });
  for (const m of [null, 5, {}, { rateLimits: 'x' }, { rateLimits: [] }]) assert.deepStrictEqual(codexQuota(m), { kind: 'failed', failure: 'malformed' }, JSON.stringify(m));
  assert.deepStrictEqual(sanitiseQuotaRead(codexQuota({ rateLimits: { primary: { usedPercent: 'lots' } } }), NOW), { kind: 'failed', failure: 'malformed' });
  // errors become fixed kinds
  assert.strictEqual(quotaFailureOf(new Error('401 Unauthorized')), 'signed-out');
  assert.strictEqual(quotaFailureOf(new Error('HTTP 429 Too Many Requests')), 'rate-limited');
  assert.strictEqual(quotaFailureOf(new Error('rate limit exceeded')), 'rate-limited');
  assert.strictEqual(quotaFailureOf(new Error('request timed out')), 'timeout');
  assert.strictEqual(quotaFailureOf(new Error('boom ghp_secret')), 'unavailable');
  assert.strictEqual(quotaFailureOf(undefined), 'unavailable');
}

// ---- FR-084: a failed read keeps good figures, marked; signed-out and a new "no figures" answer do not
{
  const good = applyQuotaRead(undefined, okRead([reqs({ used: 5, limit: 10 })]), NOW);
  for (const failure of ['unavailable', 'timeout', 'malformed', 'rate-limited'] as const) {
    const e = applyQuotaRead(good, { kind: 'failed', failure }, NOW + MIN);
    const v = quotaView('a', e);
    assert.deepStrictEqual(v.buckets.map((b) => b.used), [5], `${failure} keeps the figures`);
    assert.strictEqual(v.checkedAt, NOW, 'the checked time stays that of the reading, not the failure');
    assert.strictEqual(quotaState(v, NOW + MIN), 'failed-kept');
    const d = quotaDisplay(v, NOW + MIN, { tz: TZ });
    assert.strictEqual(d.word, 'Last reading, not current', 'never a success-shaped word');
    assert.notStrictEqual(d.tone, 'ok');
    assert.ok(d.notes.some((n) => n.startsWith('Could not read at')), 'the failure and its time are said');
    assert.match(quotaLine(v, NOW + MIN, { tz: TZ }), /Last reading, not current/);
    assert.ok(!/Checked /.test(quotaLine(v, NOW + MIN, { tz: TZ })), 'the line does not claim a fresh check');
  }
  const out = applyQuotaRead(good, { kind: 'failed', failure: 'signed-out' }, NOW + MIN);
  assert.deepStrictEqual(quotaView('a', out).buckets, [], 'signed out: figures of that account are gone');
  assert.strictEqual(quotaState(quotaView('a', out), NOW + MIN), 'failed');
  const none = applyQuotaRead(good, { kind: 'not-reported', reason: 'api-key' }, NOW + MIN);
  assert.strictEqual(quotaState(quotaView('a', none), NOW + MIN), 'not-reported');
  assert.deepStrictEqual(quotaView('a', none).buckets, []);
  // a new good read clears the failure
  const back = applyQuotaRead(applyQuotaRead(good, { kind: 'failed', failure: 'timeout' }, NOW + MIN), okRead([reqs({ used: 6 })]), NOW + 2 * MIN);
  assert.strictEqual(quotaState(quotaView('a', back), NOW + 2 * MIN), 'current');
  assert.strictEqual(quotaView('a', back).failure, undefined);
  // no earlier figures: a plain failure
  assert.strictEqual(quotaDisplay(quotaView('a', applyQuotaRead(undefined, { kind: 'failed', failure: 'malformed' }, NOW)), NOW).word, 'Could not read');
  assert.strictEqual(quotaLine(quotaView('a', applyQuotaRead(undefined, { kind: 'failed', failure: 'malformed' }, NOW)), NOW), 'Account limits: could not be read.');
}

// ---- FR-085: stale is never current; the reset boundary
{
  const v = viewOf([reqs({ used: 5, limit: 10, resetsAt: NOW + 60 * MIN })]);
  assert.strictEqual(quotaState(v, NOW), 'current');
  assert.strictEqual(quotaState(v, NOW + QUOTA_STALE_MS - 1), 'current');
  assert.strictEqual(quotaState(v, NOW + QUOTA_STALE_MS), 'stale', 'at the boundary');
  const old = quotaDisplay(v, NOW + QUOTA_STALE_MS, { tz: TZ });
  assert.strictEqual(old.word, 'Last reading, not current');
  assert.notStrictEqual(old.tone, 'ok');
  assert.ok(old.notes.some((n) => /old/.test(n)));
  assert.match(quotaLine(v, NOW + QUOTA_STALE_MS, { tz: TZ }), /^Account limits: .*Last reading, not current/);
  assert.strictEqual(quotaDisplay(v, NOW).nextChangeAt, NOW + QUOTA_STALE_MS, 'the window repaints when it goes stale');
  // reset time passes: stale at exactly that moment; not near or used up any more
  const full = viewOf([reqs({ used: 10, limit: 10, remainingPercent: 0, resetsAt: NOW + MIN })]);
  assert.strictEqual(quotaDisplay(full, NOW).exhausted, true);
  assert.strictEqual(quotaDisplay(full, NOW).nextChangeAt, NOW + MIN);
  assert.strictEqual(quotaDisplay(full, NOW + MIN - 1).exhausted, true, 'one ms before');
  const after = quotaDisplay(full, NOW + MIN, { tz: TZ });
  assert.deepStrictEqual([after.state, after.exhausted, after.near], ['stale', false, false], 'at the reset');
  assert.match(facts(full, NOW + MIN).Resets, /^passed at .*before it$/);
  assert.match(quotaLine(full, NOW + MIN, { tz: TZ }), /reset time passed/);
  // nothing further to wait for: no timer
  assert.strictEqual(quotaDisplay(viewOf([reqs({ used: 1 })], NOW - QUOTA_STALE_MS), NOW).nextChangeAt, undefined);
  // no figures: not checked, never zero
  assert.strictEqual(quotaState({ app: 'a', buckets: [] }, NOW), 'not-checked');
}

// ---- FR-080, FR-086: absent says "not reported", never zero; units; zones
{
  const f = facts(viewOf([reqs({ unit: 'requests', resetsAt: undefined, used: undefined, remainingPercent: 50 })]));
  assert.deepStrictEqual(f, { Used: QUOTA_NOT_REPORTED, Limit: QUOTA_NOT_REPORTED, Left: '50%', Resets: QUOTA_NOT_REPORTED });
  const z = facts(viewOf([reqs({ used: 0, limit: 0, remainingPercent: 0 })]));
  assert.deepStrictEqual([z.Used, z.Limit, z.Left], ['0 requests', '0 requests', '0%'], 'a reported zero reads zero');
  const un = facts(viewOf([reqs({ used: 12345, unlimited: true })]));
  assert.deepStrictEqual(un, { Used: '12,345 requests', Limit: 'Unlimited' });
  const p = facts(viewOf([pctB({ usedPercent: 12, windowMins: 300, resetsAt: NOW + 60 * MIN })]));
  assert.deepStrictEqual([p.Used, p.Limit, p.Window], ['12%', QUOTA_NOT_REPORTED, '5 hours'], 'percent never becomes requests');
  assert.match(p.Resets, /Oct 31, 13:00 UTC/);
  assert.ok(!/reported in/.test(p.Resets), 'no zone given: none claimed');
  assert.match(facts(viewOf([reqs({ used: 1, resetsAt: NOW + 60 * MIN, resetZone: 'UTC', resetEstimated: true })])).Resets, /\(estimated, reported in UTC\)$/);
  assert.deepStrictEqual([facts(viewOf([pctB({ usedPercent: 99.96 })])).Used, facts(viewOf([reqs({ remainingPercent: 0.04 })])).Left], ['over 99.9%', 'under 0.1%'], 'rounding never claims a state');
  assert.match(quotaDisplay(viewOf([reqs({ used: 1, overageAllowed: true })]), NOW).rows[0].facts.map((x) => x.value).join(' '), /may cost money/);
  assert.match(quotaLine(viewOf([reqs({ used: 506, limit: 1500 })]), NOW, { tz: TZ }), /^Account limits: Premium, 506 of 1,500 requests used\. Checked /);
  assert.strictEqual(quotaLine({ app: 'a', buckets: [], reason: 'no-read' }, NOW), 'Account limits: not reported.');
  assert.strictEqual(quotaLine({ app: 'a', buckets: [] }, NOW), 'Account limits: not checked yet.');
  assert.strictEqual(quotaDisplay({ app: 'a', buckets: [], reason: 'no-read' }, NOW).word, 'Not reported');
}

// ---- FR-087: near a limit only from reported values
{
  const lvl = (b: QuotaBucket): string => quotaLevel(b, NOW);
  assert.strictEqual(NEAR_PERCENT, 10);
  assert.strictEqual(lvl(reqs({ remainingPercent: 10 })), 'near', 'at the threshold');
  assert.strictEqual(lvl(reqs({ remainingPercent: 10.1 })), '');
  assert.strictEqual(lvl(reqs({ remainingPercent: 0 })), 'exhausted');
  assert.strictEqual(lvl(pctB({ usedPercent: 90 })), 'near');
  assert.strictEqual(lvl(pctB({ usedPercent: 89.9 })), '');
  assert.strictEqual(lvl(pctB({ usedPercent: 100 })), 'exhausted');
  assert.strictEqual(lvl(reqs({ used: 95, limit: 100 })), 'near');
  assert.strictEqual(lvl(reqs({ used: 150, limit: 100 })), 'exhausted', 'past the limit');
  assert.strictEqual(lvl(reqs({ remaining: 5, limit: 100 })), 'near');
  assert.strictEqual(lvl(reqs({ used: 95 })), '', 'no limit reported: no guess');
  assert.strictEqual(lvl(reqs({ limit: 100 })), '', 'nothing used reported: no guess');
  assert.strictEqual(lvl(reqs({ used: 0, limit: 0, remainingPercent: 0 })), '', 'a plan with none of these is no warning');
  assert.strictEqual(lvl(reqs({ unlimited: true, used: 1e9 })), '');
  assert.strictEqual(lvl(reqs({ remainingPercent: 0, resetsAt: NOW })), '', 'reset passed');
}

// ---- FR-088: the alternatives
{
  const near = viewOf([reqs({ remainingPercent: 5 })]);
  const room = viewOf([reqs({ remainingPercent: 50 })]);
  const list = quotaAlternatives('a', [
    { id: 'a', name: 'A', ready: true, signedIn: true, view: near },
    { id: 'b', name: 'B', ready: true, signedIn: true, view: room },
    { id: 'c', name: 'C', ready: true, signedIn: true },
    { id: 'd', name: 'D', ready: false, signedIn: true, view: room },
    { id: 'e', name: 'E', ready: true, signedIn: false, view: room },
    { id: 'f', name: 'F', ready: true, signedIn: true, view: near },
    { id: 'g', name: 'G', ready: true, signedIn: true, view: viewOf([reqs({ remainingPercent: 50 })], NOW - QUOTA_STALE_MS) },
  ], NOW);
  assert.deepStrictEqual(list, [{ id: 'b', name: 'B', known: true }, { id: 'c', name: 'C', known: false }, { id: 'g', name: 'G', known: false }], 'never itself, not ready, signed out or near; unknown and stale say so');
  assert.deepStrictEqual(quotaAlternatives('a', [], NOW), []);
  // the window offers only a person's own click (static): no send, start or route from the quota code
  const hs = read('src/renderer/harnesses.js');
  const block = hs.slice(hs.indexOf('spec 011 FR-085..FR-090'), hs.indexOf('/* running an operation:'));
  assert.ok(block.length > 500 && !/B\.(?!harnessQuota)\w+\(/.test(block), 'the quota code calls no other bridge method');
  assert.ok(!/setTimeout\([^,]+,\s*\d/.test(block) && (block.match(/setTimeout\(/g) ?? []).length === 1 && !/setInterval/.test(block), 'one timer, no interval');
}

// ---- FR-083: floors, one read at a time, time limit, late answers, forget, no timers left
async function cacheTests(): Promise<void> {
  const info = (id: string, state = 'ready'): AdapterInfo => ({ id, displayName: id, state, capabilities: {} } as unknown as AdapterInfo);
  let now = NOW;
  let calls = 0;
  let answer: () => Promise<unknown> = async () => okRead([reqs({ used: 5, limit: 10 })]);
  const infos = [info('a')];
  const make = (timeoutMs = 1000, maxRunMs = 30_000) =>
    createQuotaCache({ list: async () => infos, check: () => async () => { calls++; return answer(); }, now: () => now, timeoutMs, maxRunMs });
  let c = make();
  assert.deepStrictEqual((await c.get('cached')).a, { app: 'a', buckets: [] }, 'cached asks nothing');
  assert.strictEqual(calls, 0);
  assert.strictEqual(quotaShouldAsk(undefined, 'cached', now), false);
  await c.get('open');
  assert.strictEqual(calls, 1, 'first open asks');
  for (let i = 0; i < 20; i++) await c.get('open');
  await c.get('cached');
  assert.strictEqual(calls, 1, 'no second ask within the floor');
  now += QUOTA_CHECK_MS - 1;
  await c.get('check');
  assert.strictEqual(calls, 1, 'Check again within 30 s asks nothing');
  now += 1;
  await c.get('check');
  assert.strictEqual(calls, 2, 'Check again after the floor');
  await c.get('open');
  assert.strictEqual(calls, 2);
  now += QUOTA_OPEN_MS;
  await c.get('open');
  assert.strictEqual(calls, 3, 'open after its floor');

  // a failed read keeps the figures through the cache; the thrown text is nowhere
  now += QUOTA_OPEN_MS;
  answer = async () => { throw new Error('ghp_SECRETTOKEN at /Users/x/.copilot'); };
  let v = (await c.get('check')).a;
  assert.deepStrictEqual([v.buckets.length, v.failure], [1, 'unavailable']);
  assert.ok(!JSON.stringify(v).includes('SECRET') && !JSON.stringify(v).includes('.copilot'));
  // hostile answer from an adapter: sanitised in main
  now += QUOTA_OPEN_MS;
  answer = async () => ({ kind: 'ok', source: 'x\u202e', buckets: [{ id: 'q', label: 'L', unit: 'requests', used: Infinity, limit: 3 }] });
  v = (await c.get('check')).a;
  assert.ok(!('used' in v.buckets[0]) && v.buckets[0].limit === 3 && !v.source?.includes('\u202e'));
  // malformed keeps what was there
  now += QUOTA_OPEN_MS;
  answer = async () => 'nonsense';
  v = (await c.get('check')).a;
  assert.deepStrictEqual([v.buckets[0].limit, v.failure], [3, 'malformed']);

  // rate limited: asks stop for 5 minutes, also on Check again
  c = make();
  calls = 0;
  answer = async () => ({ kind: 'failed', failure: 'rate-limited' });
  v = (await c.get('open')).a;
  assert.deepStrictEqual([calls, v.failure, v.backoffUntil], [1, 'rate-limited', now + QUOTA_BACKOFF_MS]);
  now += QUOTA_BACKOFF_MS - 1;
  await c.get('check');
  assert.strictEqual(calls, 1, 'a click does not get round the provider');
  now += 1;
  answer = async () => okRead([reqs({ used: 1 })]);
  v = (await c.get('check')).a;
  assert.deepStrictEqual([calls, v.backoffUntil, v.failure], [2, undefined, undefined]);

  // one read at a time: a refresh joins
  c = make();
  calls = 0;
  let release: (x: unknown) => void = () => undefined;
  answer = () => new Promise((r) => { release = r; });
  const p1 = c.get('open');
  const p2 = c.get('open');
  await new Promise((r) => setImmediate(r));
  now += 1000;
  const p3 = c.get('check');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(calls, 1, 'joined');
  release(okRead([reqs({ used: 7 })]));
  const [a1, a2, a3] = await Promise.all([p1, p2, p3]);
  assert.deepStrictEqual([a1.a.buckets[0].used, a2.a.buckets[0].used, a3.a.buckets[0].used], [7, 7, 7]);

  // the time limit: a failure, the figures kept, the timer cleared; a late answer changes nothing; a new read after maxRun
  const realSet = global.setTimeout, realClear = global.clearTimeout;
  const pending = new Set<unknown>();
  (global as unknown as { setTimeout: unknown }).setTimeout = (fn: () => void, ms?: number) => { const t = realSet(() => { pending.delete(t); fn(); }, ms); pending.add(t); return t; };
  (global as unknown as { clearTimeout: unknown }).clearTimeout = (t: never) => { pending.delete(t); realClear(t); };
  try {
    c = make(15, 60_000);
    calls = 0;
    answer = async () => okRead([reqs({ used: 1 })]);
    await c.get('open');
    assert.strictEqual(pending.size, 0, 'the time limit timer is cleared after an answer');
    now += QUOTA_OPEN_MS;
    let late: (x: unknown) => void = () => undefined;
    answer = () => new Promise((r) => { late = r; });
    v = (await c.get('check')).a;
    assert.deepStrictEqual([v.failure, v.buckets[0].used], ['timeout', 1], 'hung: reported, figures kept');
    assert.strictEqual(pending.size, 0, 'no timer left after the time limit either');
    const hung = calls;
    now += QUOTA_CHECK_MS;
    await c.get('check');
    assert.strictEqual(calls, hung, 'still running: no second call beside it');
    now += 60_000; // past maxRun
    answer = async () => okRead([reqs({ used: 2 })]);
    v = (await c.get('check')).a;
    assert.strictEqual(v.buckets[0].used, 2, 'a hung call never blocks for ever');
    late(okRead([reqs({ used: 999 })]));
    await new Promise((r) => setImmediate(r));
    assert.strictEqual((await c.get('cached')).a.buckets[0].used, 2, 'the old answer does not overwrite a newer one');
    // same, when no newer read came: late is dropped too (the failure stands until asked again)
    now += QUOTA_OPEN_MS;
    let late2: (x: unknown) => void = () => undefined;
    answer = () => new Promise((r) => { late2 = r; });
    v = (await c.get('check')).a;
    assert.strictEqual(v.failure, 'timeout');
    late2(okRead([reqs({ used: 500 })]));
    await new Promise((r) => setImmediate(r));
    v = (await c.get('cached')).a;
    assert.deepStrictEqual([v.failure, v.buckets[0].used], ['timeout', 2]);
    assert.strictEqual(pending.size, 0, 'no timer is ever left running');
  } finally {
    global.setTimeout = realSet;
    global.clearTimeout = realClear;
  }

  // forget (a sign-in ended): figures gone, an answer in flight ignored, asked again at once
  c = make();
  calls = 0;
  answer = async () => okRead([reqs({ used: 1 })]);
  await c.get('open');
  let slow: (x: unknown) => void = () => undefined;
  now += QUOTA_OPEN_MS;
  answer = () => new Promise((r) => { slow = r; });
  const inflight = c.get('open');
  await new Promise((r) => setImmediate(r));
  c.forget('a');
  slow(okRead([reqs({ used: 77 })]));
  await inflight;
  assert.deepStrictEqual((await c.get('cached')).a.buckets, [], 'the earlier account\'s figures are gone');
  answer = async () => okRead([reqs({ used: 3 })]);
  calls = 0;
  assert.strictEqual((await c.get('open')).a.buckets[0].used, 3);
  assert.strictEqual(calls, 1, 'asked at once after a sign-in');

  // an app that stops being ready or signs out loses its figures; not installed is not listed; no read call: not reported
  infos[0] = info('a', 'not-signed-in');
  v = (await c.get('open')).a;
  assert.deepStrictEqual([v.buckets, v.failure], [[], 'signed-out']);
  infos[0] = info('a');
  now += QUOTA_OPEN_MS;
  assert.deepStrictEqual((await c.get('cached')).a.buckets, [], 'not back after signing in again');
  await c.get('open');
  infos[0] = info('a', 'too-old');
  assert.deepStrictEqual(await c.get('open'), {});
  infos[0] = info('a');
  assert.deepStrictEqual((await c.get('cached')).a.buckets, []);
  const noCall = createQuotaCache({ list: async () => [info('claude'), info('x')], check: () => undefined, now: () => now });
  const nc = await noCall.get('check');
  assert.strictEqual(nc.claude.reason, 'no-read');
  assert.strictEqual(quotaDisplay(nc.claude, now).word, 'Not reported');
  assert.deepStrictEqual(Object.keys(await noCall.get('open', 'claude')), ['claude'], 'one app only');
  const brokenList = createQuotaCache({ list: async () => { throw new Error('x'); }, check: () => undefined });
  assert.deepStrictEqual(await brokenList.get('open'), {});
  // units per app: the answer is keyed by app and nothing adds them up
  assert.ok(!/reduce\(|\+=/.test(read('src/main/quota.ts')), 'no total in main');
  const shared = read('src/shared/quota.ts');
  assert.ok(!/\btotal\b/i.test(shared.replace(/\/\*[\s\S]*?\*\//g, '')), 'no total in the contract');

  // quotaCheck: never under the simulator; only an adapter with the member
  const withMember = { accountQuota: async (): Promise<QuotaRead> => ({ kind: 'not-reported', reason: 'none' }) };
  assert.strictEqual(quotaCheck({ simulator: true, has: () => true, instance: () => withMember })('a'), undefined);
  assert.strictEqual(quotaCheck({ simulator: false, has: () => false, instance: () => withMember })('a'), undefined);
  assert.strictEqual(quotaCheck({ simulator: false, has: () => true, instance: () => ({}) })('a'), undefined);
  assert.strictEqual(quotaCheck({ simulator: false, has: () => true, instance: () => { throw new Error('x'); } })('a'), undefined);
  assert.strictEqual(typeof quotaCheck({ simulator: false, has: () => true, instance: () => withMember })('a'), 'function');

  // FR-090: a refusal is never an empty success
  const cache = { get: async () => ({ a: { app: 'a', buckets: [] } }) };
  const kind = (k: unknown): boolean => k === 'a';
  assert.deepStrictEqual(await quotaIpcAnswer(false, 'open', undefined, cache, kind), { ok: false, error: 'refused' });
  assert.deepStrictEqual(await quotaIpcAnswer(true, 'poll', undefined, cache, kind), { ok: false, error: 'invalid request' });
  assert.deepStrictEqual(await quotaIpcAnswer(true, undefined, undefined, cache, kind), { ok: false, error: 'invalid request' });
  assert.deepStrictEqual(await quotaIpcAnswer(true, 'open', '__proto__', cache, kind), { ok: false, error: 'invalid request' });
  assert.deepStrictEqual(await quotaIpcAnswer(true, 'open', 'a', { get: async () => { throw new Error('secret text'); } }, kind), { ok: false, error: 'could not read' });
  assert.deepStrictEqual(await quotaIpcAnswer(true, 'open', 'a', cache, kind), { ok: true, apps: { a: { app: 'a', buckets: [] } } });
  assert.strictEqual(simChannelOpen('harness:quota'), false, 'refused under the simulator');

  // ---- FR-081: the real adapters on fakes. No session, no thread, no turn
  assert.strictEqual(COPILOT_CAPABILITIES.accountQuota, true);
  assert.strictEqual(CODEX_CAPABILITIES.accountQuota, true);
  assert.strictEqual(CLAUDE_CAPABILITIES.accountQuota, undefined, 'Claude Code has no free call (research matrix)');
  const copilotRun = async (set: (x: FakeClient) => void): Promise<{ r: QuotaRead; calls: string[]; c: FakeClient }> => {
    const client = new FakeClient();
    set(client);
    const r = await new FakeCopilot(client).accountQuota();
    return { r, calls: client.authCalls, c: client };
  };
  let cr = await copilotRun((x) => { x.quotaResult = { quotaSnapshots: { premium_interactions: { entitlementRequests: 100, usedRequests: 4 } } }; });
  assert.deepStrictEqual(cr.calls, ['account.getQuota'], 'one read, no auth status');
  assert.strictEqual(cr.c.sessions.size, 0, 'no session');
  assert.ok(cr.r.kind === 'ok' && cr.r.source.includes('getQuota'));
  cr = await copilotRun(() => undefined);
  assert.deepStrictEqual(cr.r, { kind: 'not-reported', reason: 'none' }, 'empty snapshots');
  cr = await copilotRun((x) => { x.noQuota = true; });
  assert.deepStrictEqual(cr.r, { kind: 'not-reported', reason: 'unsupported' });
  cr = await copilotRun((x) => { x.quotaFail = 'Unhandled method account.getQuota'; });
  assert.deepStrictEqual(cr.r, { kind: 'not-reported', reason: 'unsupported' });
  cr = await copilotRun((x) => { x.quotaFail = 'Bad credentials ghp_x'; });
  assert.deepStrictEqual(cr.r, { kind: 'failed', failure: 'signed-out' });
  cr = await copilotRun((x) => { x.quotaFail = '429 Too Many Requests'; });
  assert.deepStrictEqual(cr.r, { kind: 'failed', failure: 'rate-limited' });
  cr = await copilotRun((x) => { x.quotaFail = 'getaddrinfo ENOTFOUND'; });
  assert.deepStrictEqual(cr.r, { kind: 'failed', failure: 'unavailable' });

  const codexRun = async (opts: FakeCodexOptions): Promise<{ r: QuotaRead; server: FakeCodexServer }> => {
    const server = new FakeCodexServer(opts);
    const ad = new CodexAdapter({ spawn: server.spawn, locate: async () => ({ path: '/fake/codex', version: '0.163.0' }), platform: 'linux', env: {}, appVersion: '9', closeGraceMs: 20, killGraceMs: 20 });
    const r = await ad.accountQuota();
    await ad.dispose();
    return { r, server };
  };
  let xr = await codexRun({});
  assert.ok(xr.r.kind === 'ok' && xr.r.source.includes('rateLimits'));
  const methods = xr.server.wire.map((w) => w.method);
  assert.ok(methods.includes('account/rateLimits/read') && !methods.some((m) => m.startsWith('thread/') || m.startsWith('turn/')), 'no thread, no turn, no prompt');
  xr = await codexRun({ rateLimits: 'unauthorized', authMethod: 'apikey' });
  assert.deepStrictEqual(xr.r, { kind: 'not-reported', reason: 'api-key' }, 'an API key has no plan windows; not signed out');
  const auth = xr.server.requests('getAuthStatus')[0] as unknown as { params: { includeToken: boolean; refreshToken: boolean } };
  assert.deepStrictEqual([auth.params.includeToken, auth.params.refreshToken], [false, false], 'the token is never asked for');
  xr = await codexRun({ rateLimits: 'unauthorized' });
  assert.deepStrictEqual(xr.r, { kind: 'failed', failure: 'signed-out' });
  xr = await codexRun({ rateLimits: 'network' });
  assert.deepStrictEqual(xr.r, { kind: 'failed', failure: 'unavailable' });
  xr = await codexRun({ rateLimits: 'limited' });
  assert.deepStrictEqual(xr.r, { kind: 'failed', failure: 'rate-limited' });
  xr = await codexRun({ rateLimits: 'missing' });
  assert.deepStrictEqual(xr.r, { kind: 'not-reported', reason: 'unsupported' });
  xr = await codexRun({ rateLimitsResult: { rateLimits: 'hostile' } });
  assert.deepStrictEqual(xr.r, { kind: 'failed', failure: 'malformed' });

  // FR-091: no credentials, no session state, nothing saved or logged (static, comments stripped)
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  for (const f of ['src/main/quota.ts', 'src/shared/quota.ts', 'src/adapters/quotamap.ts']) {
    const src = strip(read(f));
    assert.ok(!/from 'fs'|require\('fs'\)|\.claude|\.copilot|\.codex\b|auth\.json|console\.|process\.env|sessionId|agentId|authToken/.test(src), `${f}: no files, env, logs or session ids`);
  }
  assert.ok(!/^import /m.test(strip(read('src/shared/quota.ts'))), 'shared/quota.ts has no imports (it loads in the page)');
  assert.ok(/ipcHandle\('harness:quota'/.test(read('src/main/ipc/harness.ts')), 'through ipcHandle');
  assert.ok(read('src/renderer/index.html').includes('../shared/quota.js'), 'loaded in the page');
  const adapterQuota = read('src/adapters/copilot.ts');
  assert.ok(!adapterQuota.slice(adapterQuota.indexOf('async accountQuota'), adapterQuota.indexOf('The whole plan read')).includes('createSession'), 'Copilot: no session');
}

const hang = setTimeout(() => { console.error('test-quota: hung'); process.exit(1); }, 60_000);
void cacheTests().then(() => {
  clearTimeout(hang);
  process.exitCode = 0;
  console.log('test-quota: OK');
}, (e) => {
  console.error(e);
  process.exit(1);
});
