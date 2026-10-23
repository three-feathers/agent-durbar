/** MCP elicitation tests: `npm run test:elicit` (spec 012 FR-151). Schema mapping, main's check, the answer shape, URL mode. */
import * as assert from 'assert';
import { checkElicitAnswer, createElicitTracker, elicitHttpsUrl, isSecretField, parseElicitRequest, parseElicitSchema, validateElicitContent, type ElicitAnswer, type ElicitField } from '../src/shared/elicit';
import { answerElicitation, cancelElicitations, runElicitation, type ElicitWaiter } from '../src/adapters/elicitation';
import { eventProblems } from '../src/adapters/eventguard';
import type { EventBody } from '../src/adapters/map';

// ---- schema mapping: the simple kinds, enums (enum + enumNames, and oneOf), limits, formats ----
const schema = {
  type: 'object',
  properties: {
    env: { type: 'string', title: 'Which environment?', enum: ['staging', 'production'], enumNames: ['Staging', 'Production'] },
    region: { type: 'string', oneOf: [{ const: 'eu', title: 'Europe' }, { const: 'us', title: 'United States' }] },
    ticket: { type: 'integer', title: 'Ticket number', minimum: 1, maximum: 999 },
    ratio: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
    notify: { type: 'boolean', title: 'Notify me', default: true },
    email: { type: 'string', format: 'email', maxLength: 80 },
    apiToken: { type: 'string', title: 'API token', default: 'leak-me' },
    tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } }, // optional and unsupported: dropped
    odd: { type: 'string', format: 'hostname' }, // a format we cannot check: dropped
  },
  required: ['env', 'ticket'],
};
const m = parseElicitSchema(schema);
assert.deepStrictEqual(m.unsupportedRequired, []);
assert.deepStrictEqual(m.dropped.sort(), ['odd', 'tags']);
const by = Object.fromEntries(m.fields.map((f) => [f.name, f])) as Record<string, ElicitField>;
assert.deepStrictEqual(by.env, { name: 'env', title: 'Which environment?', required: true, type: 'enum', enumValues: ['staging', 'production'], enumNames: ['Staging', 'Production'] });
assert.deepStrictEqual(by.region.enumValues, ['eu', 'us']);
assert.deepStrictEqual(by.region.enumNames, ['Europe', 'United States']);
assert.strictEqual(by.region.title, 'region', 'no title: the name');
assert.deepStrictEqual([by.ticket.type, by.ticket.min, by.ticket.max, by.ticket.required], ['integer', 1, 999, true]);
assert.strictEqual(by.ratio.default, 0.5);
assert.deepStrictEqual([by.notify.type, by.notify.default], ['boolean', true]);
assert.deepStrictEqual([by.email.format, by.email.maxLength], ['email', 80]);
assert.strictEqual(by.apiToken.secret, true, 'a token field is a password input');
assert.strictEqual(by.apiToken.default, undefined, 'a secret field never carries a default value');
assert.ok(isSecretField('password') && isSecretField('x', 'Your passphrase') && isSecretField('gh_token') && !isSecretField('environment', 'Which environment?'));
// names that are not plain identifiers are not used as keys
assert.deepStrictEqual(parseElicitSchema({ properties: { '__proto__ x': { type: 'string' } } }).fields, []);
// at most 12 fields; the rest count as dropped (or as unsupported when required)
const many = parseElicitSchema({ properties: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`f${i}`, { type: 'string' }])), required: ['f14'] });
assert.strictEqual(many.fields.length, 12);
assert.deepStrictEqual(many.unsupportedRequired, ['f14']);

// ---- an unsupported REQUIRED field: the request is declined with a reason ----
const bad = parseElicitRequest({ message: 'Pick', schema: { properties: { tags: { type: 'array', items: { type: 'string', enum: ['a'] } } }, required: ['tags'] } });
assert.ok(!bad.ok && /tags/.test(bad.reason), 'declined, naming the field');
const missing = parseElicitRequest({ message: 'x', schema: { properties: {}, required: ['ghost'] } });
assert.ok(!missing.ok, 'a required name with no property is declined');
const ok = parseElicitRequest({ message: '  Where‮ should\nthis go? ', schema, source: 'deploy-mcp' });
assert.ok(ok.ok);
if (ok.ok) {
  assert.strictEqual(ok.request.message, 'Where should this go?', 'one clean line');
  assert.strictEqual(ok.request.source, 'deploy-mcp');
  assert.strictEqual(ok.request.fields?.length, 7);
}

// ---- main-side validation ----
const fields = ok.ok ? ok.request.fields! : [];
const good = validateElicitContent(fields, { env: 'production', ticket: 42, notify: false, email: 'a@b.example', extra: 'dropped', region: '' });
assert.ok(good.ok);
if (good.ok) assert.deepStrictEqual(good.content, { env: 'production', ticket: 42, notify: false, email: 'a@b.example' }, 'unknown keys and empty optional fields are left out');
const v = (vals: Record<string, unknown>) => validateElicitContent(fields, { env: 'staging', ticket: 1, ...vals });
assert.deepStrictEqual(v({ env: undefined }), { ok: false, error: 'Fill in "Which environment?".', field: 'env' });
assert.ok(!v({ ticket: '' }).ok, 'required number left empty');
assert.ok(!v({ env: 'dev' }).ok, 'not one of the choices');
assert.ok(!v({ ticket: 1.5 }).ok, 'an integer must be whole');
assert.ok(!v({ ticket: 0 }).ok && !v({ ticket: 1000 }).ok, 'min and max');
assert.ok(!v({ ticket: Number.NaN }).ok && !v({ ticket: 'abc' }).ok, 'not a number');
const asText = v({ ticket: '7' });
assert.ok(asText.ok && asText.content.ticket === 7, 'a number typed as text is read as a number');
assert.ok(!v({ notify: 'yes' }).ok, 'a boolean must be a boolean');
assert.ok(!v({ email: 'nope' }).ok, 'email format');
assert.ok(!v({ email: 'a@b.example' + 'x'.repeat(80) }).ok, 'maxLength');
assert.ok(!v({ region: 5 }).ok, 'an enum value must be text');
const secretErr = v({ email: 'secret-value-123' });
assert.ok(!secretErr.ok && !secretErr.error.includes('secret-value-123'), 'an error never repeats the value');
const fmt = (format: ElicitField['format'], value: string) => validateElicitContent([{ name: 'x', title: 'X', type: 'string', format }], { x: value }).ok;
assert.ok(fmt('date', '2026-10-20') && !fmt('date', '2026-13-01') && !fmt('date', '20/10/2026'));
assert.ok(fmt('date-time', '2026-10-20T09:30') && fmt('date-time', '2026-10-20T09:30:00Z') && !fmt('date-time', 'tomorrow'));
assert.ok(fmt('uri', 'https://a.example/x') && !fmt('uri', 'not a url'));
const minLen = validateElicitContent([{ name: 'x', title: 'X', type: 'string', minLength: 3 }], { x: 'ab' });
assert.ok(!minLen.ok);
assert.ok(!validateElicitContent([{ name: 'x', title: 'X', type: 'string' }], { x: 'y'.repeat(2001) }).ok, 'text is capped at 2000 characters');

// ---- the answer main passes on: {action, content} for a form; no content for decline, cancel or a URL flow ----
if (ok.ok) {
  assert.deepStrictEqual(checkElicitAnswer(ok.request, 'accept', { env: 'staging', ticket: 3, notify: true }), { ok: true, answer: { action: 'accept', content: { env: 'staging', ticket: 3, notify: true } } });
  assert.deepStrictEqual(checkElicitAnswer(ok.request, 'decline', { env: 'x' }), { ok: true, answer: { action: 'decline' } });
  assert.deepStrictEqual(checkElicitAnswer(ok.request, 'cancel', undefined), { ok: true, answer: { action: 'cancel' } });
  assert.strictEqual(checkElicitAnswer(ok.request, 'accept', { ticket: 3 }).ok, false, 'a missing required field is refused in main');
  assert.strictEqual(checkElicitAnswer(ok.request, 'approve', {}).ok, false, 'unknown action');
}
assert.deepStrictEqual(checkElicitAnswer({ message: 'm', url: 'https://a.example', host: 'a.example' }, 'accept', { x: 1 }), { ok: true, answer: { action: 'accept' } });

// ---- URL mode: https only, no user:password, host shown ----
assert.deepStrictEqual(elicitHttpsUrl('https://auth.example.com/device?code=1'), { url: 'https://auth.example.com/device?code=1', host: 'auth.example.com' });
for (const b of ['http://a.example', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'https://user:pw@a.example/', 'https://' + 'a'.repeat(3000), '', null, 5, 'vscode://x'])
  assert.strictEqual(elicitHttpsUrl(b), undefined, String(b).slice(0, 40));
const u = parseElicitRequest({ message: 'Sign in', mode: 'url', url: 'https://auth.example.com/x' });
assert.ok(u.ok && u.request.host === 'auth.example.com' && u.request.fields === undefined);
const uBad = parseElicitRequest({ message: 'Sign in', mode: 'url', url: 'http://auth.example.com/x' });
assert.ok(!uBad.ok && /https/.test(uBad.reason), 'a non-https page is declined');

// ---- main's tracker: asked adds, answered or cancelled removes ----
const tr = createElicitTracker();
const req = { message: 'm', fields: [] };
tr.onEvent({ type: 'question', sessionId: 's', phase: 'asked', requestId: 'r', elicitation: req });
tr.onEvent({ type: 'question', sessionId: 's', phase: 'asked', requestId: 'plain' });
assert.strictEqual(tr.get('s', 'r'), req);
assert.strictEqual(tr.get('s', 'plain'), undefined, 'a plain question is not an elicitation');
assert.strictEqual(tr.get('other', 'r'), undefined, 'keyed by session too');
tr.onEvent({ type: 'question', sessionId: 's', phase: 'cancelled', requestId: 'r' });
assert.strictEqual(tr.get('s', 'r'), undefined);

// ---- the adapters' shared flow: event shapes, values never in events, the accept payload, decline and cancel ----
void (async () => {
  const events: EventBody[] = [];
  const pending = new Map<string, ElicitWaiter>();
  const emit = (b: EventBody) => events.push(b);
  const p = runElicitation(emit, pending, 'r1', { message: 'Where?', schema, source: 'deploy-mcp' });
  const asked = events.find((e) => e.type === 'question' && e.phase === 'asked') as Extract<EventBody, { type: 'question' }>;
  assert.ok(asked?.elicitation?.fields?.length === 7 && asked.questions?.[0].question === 'Where?' && asked.questions[0].header === 'deploy-mcp');
  assert.deepStrictEqual(eventProblems({ ...asked, sessionId: 's', timestamp: 1 }), [], 'the asked event passes the event guard');
  assert.ok(events.some((e) => e.type === 'status' && e.status === 'needs-permission'));
  answerElicitation(pending, 'nope', { action: 'decline' }); // unknown ids are ignored
  answerElicitation(pending, 'r1', { action: 'accept', content: { env: 'staging', ticket: 9, apiToken: 'tok-123456' } });
  assert.deepStrictEqual(await p, { action: 'accept', content: { env: 'staging', ticket: 9, apiToken: 'tok-123456' } });
  const answered = events.find((e) => e.type === 'question' && e.phase === 'answered') as Extract<EventBody, { type: 'question' }>;
  assert.strictEqual(answered.elicitAction, 'accept');
  assert.ok(!JSON.stringify(events).includes('tok-123456'), 'values never go into an event');
  assert.strictEqual(pending.size, 0);

  // an answer that fails the adapter's own check is declined, never passed on
  const p2 = runElicitation(emit, pending, 'r2', { message: 'Where?', schema });
  answerElicitation(pending, 'r2', { action: 'accept', content: { env: 'nowhere', ticket: 9 } });
  assert.deepStrictEqual(await p2, { action: 'decline' } as ElicitAnswer);

  // Stop / End: cancelled; a cancel emits `cancelled` and no status (Stop sets it)
  const before = events.length;
  const p3 = runElicitation(emit, pending, 'r3', { message: 'Sign in', mode: 'url', url: 'https://auth.example.com/x' });
  cancelElicitations(pending);
  assert.deepStrictEqual(await p3, { action: 'cancel' });
  const tail = events.slice(before + 2);
  assert.deepStrictEqual(tail.map((e) => e.type + ':' + ((e as { phase?: string }).phase ?? (e as { status?: string }).status)), ['question:cancelled']);

  // URL mode Done: accept, never content
  const p4 = runElicitation(emit, pending, 'r4', { message: 'Sign in', mode: 'url', url: 'https://auth.example.com/x' });
  answerElicitation(pending, 'r4', { action: 'accept', content: { x: 'y' } });
  assert.deepStrictEqual(await p4, { action: 'accept' });

  // an unsupported required field: declined at once, the user is told why, nothing waits
  const n = events.length;
  const r5 = await runElicitation(emit, pending, 'r5', { message: 'x', schema: { properties: { tags: { type: 'array' } }, required: ['tags'] } });
  assert.deepStrictEqual(r5, { action: 'decline' });
  assert.ok(events.slice(n).every((e) => e.type === 'status') && /Declined an MCP request/.test(String((events[n] as { intent?: string }).intent)));
  console.log('elicit tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// ---- review on #598: the stored form is what is capped, and the function is idempotent ----
{
  const long = 'https://a.example.com/' + '\u00e9'.repeat(1010); // 1,032 characters in, about 6,000 after percent-encoding
  assert.ok(long.length < 2048);
  assert.strictEqual(elicitHttpsUrl(long), undefined, 'refused when the normalised address is over 2048 characters');
  for (const x of ['https://a.example.com/x y', 'https://\u0430uth.example.com/p?q=\u00e9', 'https://A.Example.com:443/%7Efoo/../bar', 'https://a.example.com/' + 'a'.repeat(2000), 'https://a.example.com/' + '\u00e9'.repeat(300)]) {
    const r = elicitHttpsUrl(x);
    if (r) assert.ok(elicitHttpsUrl(r.url) && elicitHttpsUrl(r.url)!.url === r.url && r.url.length <= 2048, `idempotent: ${x.slice(0, 40)}`);
  }
}
console.log('elicit: normalised length cap and idempotence ok');
