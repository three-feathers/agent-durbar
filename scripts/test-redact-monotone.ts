/**
 * Spec 012 FR-182 (review of PR 1721, round 4): the masks never show what the masks before PR 1721 hid. A differential fuzz against frozen copies of
 * `redact.ts` and `safetext.js` as they were on main before the PR (scripts/fixtures/*-main-ref.*): on every surface, no case may show a secret (the
 * password, or 8 characters of a token body) that the reference hides. A proper PRNG (mulberry32), de-duplicated cases, at least 20,000 distinct ones,
 * in several composition orders, with env lines, quoted values, keywords, split tokens and the pieces of FR-182. Every token and value is invented.
 */
import * as assert from 'assert';
import * as path from 'path';
import * as HEAD from '../src/shared/redact';
import * as REF from './fixtures/redact-main-ref';
import './safetext-shared';

type Desk = { maskRaw(t: string, r: (s: string) => string): string; excerpt(t: string, r: (s: string) => string): string; maskLabel(t: string, k: string, m: Record<string, (s: string) => string>): string; useShared(m: unknown): boolean };
const STH = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js')) as Desk;
const STR = require(path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'safetext-main-ref.js')) as Desk;
STR.useShared(REF);

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const AN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const PW = 'Hx9Kq2Lm7Np4Rs';
const PIECES = ['​', '‍', ' ', '­', '́', '﻿', '&#8203;', '&#8203', '&#x200B', '<b></b>', '<!-- -->', '<wbr>', '<br>', '</p><p>', '\n', '\r\n', '\n\n', '\n> ', '\n- ', '\n- [ ] ', '**\n**', '`\n`', '  \n', '\n    ', ''];
const FORMS = ['mysql -u root -p' + PW, 'mysql -p' + PW, 'password=' + PW, 'password: ' + PW, 'token: ' + PW, 'TOKEN ' + PW, 'API_KEY=' + PW, 'PGPASSWORD="' + PW + '"',
  'export GH_TOKEN=' + PW, 'DB_PASSWORD=' + PW, 'Db_Password=' + PW, 'curl -u bob:' + PW + ' h', '--password ' + PW, 'Authorization: Bearer ' + PW, 'https://u:' + PW + '@h.example/x',
  'https://h.example/x?token=' + PW, '{"password":"' + PW + '"}', 'secret_key = "' + PW + '"', 'see the docs', 'Release2024', 'src/app/main', ':x-oauth-basic', 'Alternatively'];
const LEADS = ['', 'see ', 'password=', 'x', 'Token:<br/>', '`', '**', '- [ ] ', 'page2 ', 'note​', '> ', 'export T='];
const JOIN = ['', ' ', '\n', '\r\n', '\n\n', ', ', '<br>', '​'];

const run = (seed: number, cases: number) => {
  const r = mulberry32(seed);
  const n = (k: number) => Math.floor(r() * k);
  const b = (k: number, set = AN) => Array.from({ length: k }, () => set[n(set.length)]).join('');
  const toks = [() => 'ghp_' + b(36), () => 'github_pat_' + b(22) + '_' + b(59), () => 'sk-proj-' + b(40), () => 'glpat-' + b(20), () => 'AKIA' + b(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'),
    () => 'xoxb-' + b(12, '0123456789') + '-' + b(24), () => 'AIza' + b(35), () => 'sk_live_' + b(24), () => 'npm_' + b(36), () => 'hf_' + b(34)];
  const seen = new Set<string>();
  const leaks: string[] = [];
  let tries = 0;
  while (seen.size < cases && tries++ < cases * 3) {
    const tok = toks[n(toks.length)]();
    const body = tok.length > 30 ? 6 : 4;
    const cut = body + n(tok.length - body);
    const split = n(3) ? tok.slice(0, cut) + PIECES[n(PIECES.length)] + tok.slice(cut) : tok;
    const parts = [LEADS[n(LEADS.length)] + split, PIECES[n(PIECES.length)] + FORMS[n(FORMS.length)]];
    if (n(3) === 0) parts.push(FORMS[n(FORMS.length)]);
    for (let i = parts.length - 1; i > 0; i--) { const j = n(i + 1); [parts[i], parts[j]] = [parts[j], parts[i]]; } // every composition order
    const t = parts.join(JOIN[n(JOIN.length)]);
    if (seen.has(t)) continue;
    seen.add(t);
    const secrets = [PW];
    for (let k = body; k + 8 <= tok.length; k++) secrets.push(tok.slice(k, k + 8));
    const shown = (o: string) => secrets.filter((x) => o.includes(x));
    const pairs: Array<[string, string, string]> = [
      ['redact', HEAD.redact(t, {}), REF.redact(t, {})],
      ['maskSecretCommand', HEAD.maskSecretCommand('echo ' + t, {}), REF.maskSecretCommand('echo ' + t, {})],
      ['maskSecretArgs', HEAD.maskSecretArgs(['run', t], {}).join(' '), REF.maskSecretArgs(['run', t], {}).join(' ')],
      ['maskSecretUrl', HEAD.maskSecretUrl('https://h.example/p?q=' + t, {}), REF.maskSecretUrl('https://h.example/p?q=' + t, {})],
      ['maskRaw', STH.maskRaw(t, (x) => HEAD.redact(x, {})), STR.maskRaw(t, (x) => REF.redact(x, {}))],
      ['excerpt', STH.excerpt(t, (x) => HEAD.redact(x, {})), STR.excerpt(t, (x) => REF.redact(x, {}))],
      ['maskLabel', STH.maskLabel(t, 'other', { redact: (x) => HEAD.redact(x, {}) }), STR.maskLabel(t, 'other', { redact: (x) => REF.redact(x, {}) })],
      ['maskLabel run', STH.maskLabel(t, 'run', { cmd: (x) => HEAD.maskSecretCommand(x, {}) }), STR.maskLabel(t, 'run', { cmd: (x) => REF.maskSecretCommand(x, {}) })],
    ];
    for (const [surface, head, ref] of pairs) {
      const refShown = new Set(shown(ref));
      const extra = shown(head).filter((x) => !refShown.has(x));
      if (extra.length && leaks.length < 12) leaks.push(`${surface}: ${JSON.stringify(t).slice(0, 160)} -> ${JSON.stringify(head).slice(0, 160)} (main: ${JSON.stringify(ref).slice(0, 120)})`);
      else if (extra.length) leaks.push(surface);
    }
  }
  return { distinct: seen.size, leaks };
};

let total = 0;
const all: string[] = [];
for (const seed of [0x1613, 0x1721, 0x2026]) {
  const { distinct, leaks } = run(seed, 7000);
  total += distinct;
  all.push(...leaks);
  console.log(`redact monotone: seed ${seed.toString(16)}: ${distinct} distinct cases, ${leaks.length} where this PR shows what main hides`);
}
assert.ok(total >= 20000, `#1613 monotone: at least 20,000 distinct cases (${total})`);
assert.strictEqual(all.length, 0, `#1613 monotone: no surface shows a secret that main's masks hide (${all.length} cases):\n${all.slice(0, 12).join('\n')}`);
console.log(`redact monotone: all checks passed (${total} distinct cases, eight surfaces)`);
