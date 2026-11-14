/**
 * Spec 012 FR-182 (review of PR 1721, round 4): the masks never show what the masks before PR 1721 hid. A differential fuzz against frozen copies of
 * `redact.ts` and `safetext.js` as they were on main before the PR (scripts/fixtures/*-main-ref.*): on every surface, no case may show a secret (the
 * password, or 8 characters of a token body) that the reference hides. A proper PRNG (mulberry32), de-duplicated cases, at least 20,000 distinct ones,
 * in several composition orders, with env lines, quoted values, keywords, split tokens and the pieces of FR-182. Every token and value is invented.
 * Surfaces: redact, the command, argument and URL masks, the desk's maskRaw, excerpt and maskLabel (other, run), maskNoteText, maskOutgoing, redactMarkdown, the
 * permission card (permText other, shell) and the tool phrase. Not here (round 5, written in FR-182): LiveAct's monitor lines (`block`, `strict`, inside create(), no
 * export; they are maskRaw, the command and URL masks and the home mask, which are covered, then cut and made plain the same way in both), plainMarks (it only
 * removes marks from a masked name) and the masks outside src/shared/redact.ts and the window (convmask, mcpmask: they call redact).
 */
import * as assert from 'assert';
import * as path from 'path';
import * as HEAD from '../src/shared/redact';
import * as REF from './fixtures/redact-main-ref';
import './safetext-shared';

import * as crypto from 'crypto';
import * as fs from 'fs';
// the frozen copies are what they say (a hash of each), and they are not this PR's code (a copy of the head would make the test pass on anything)
{
  const ROOT = path.join(__dirname, '..', '..');
  const FROZEN: Record<string, string> = { 'redact-main-ref.ts': '475cd3b363f9a451fe08bb70a6696ce540e47f3e3631e775d0c08aa043aa77f0', 'safetext-main-ref.js': 'b66357c1c96725c91e6822d1ceb9e79ed2ea0142f6d26442364111e7f578442f', 'liveact-main-ref.js': 'a1b8c16044674f634a3dc9aa8994678626603f40e4b4224587b5417bd399f6a9' };
  for (const [f, sha] of Object.entries(FROZEN)) {
    const text = fs.readFileSync(path.join(ROOT, 'scripts', 'fixtures', f));
    assert.strictEqual(crypto.createHash('sha256').update(text).digest('hex'), sha, `#1613 monotone: the frozen reference ${f} is unchanged`);
  }
  const body = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf8');
  assert.ok(!body('scripts/fixtures/redact-main-ref.ts').includes('maskSplitFirst'), '#1613 monotone: the redact reference is not the head');
  assert.ok(!body('scripts/fixtures/safetext-main-ref.js').includes('maskSplitTokens'), '#1613 monotone: the safetext reference is not the head');
  assert.ok(!body('scripts/fixtures/liveact-main-ref.js').includes('splitHides'), '#1613 monotone: the liveact reference is not the head');
}
type Desk = { maskRaw(t: string, r: (s: string) => string): string; excerpt(t: string, r: (s: string) => string): string; maskLabel(t: string, k: string, m: Record<string, (s: string) => string>): string; useShared(m: unknown): boolean };
const STH = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'safetext.js')) as Desk;
const STR = require(path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'safetext-main-ref.js')) as Desk;
STR.useShared(REF);
type Live = { permText(t: string, k: string, m: Record<string, (s: string) => string>): { text: string }; phrase(o: { kind: string; tool: string; label: string }, m: Record<string, (s: string) => string>): string };
const LAH = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'liveact.js')) as Live;
const LAR = require(path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'liveact-main-ref.js')) as Live;

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
const PW2 = 'Ab3,Cd5#Ef7^Gh9'; // a punctuated password (round 5)
const PIECES = ['​', '‍', ' ', '­', '́', '﻿', '&#8203;', '&#8203', '&#x200B', '<b></b>', '<!-- -->', '<wbr>', '<br>', '</p><p>', '\n', '\r\n', '\n\n', '\n> ', '\n- ', '\n- [ ] ', '**\n**', '`\n`', '  \n', '\n    ', ''];
const FORMS = ['mysql -u root -p' + PW, 'mysql -p' + PW, 'password=' + PW, 'password: ' + PW, 'token: ' + PW, 'TOKEN ' + PW, 'API_KEY=' + PW, 'PGPASSWORD="' + PW + '"',
  'export GH_TOKEN=' + PW, 'DB_PASSWORD=' + PW, 'Db_Password=' + PW, 'curl -u bob:' + PW + ' h', '--password ' + PW, 'Authorization: Bearer ' + PW, 'https://u:' + PW + '@h.example/x',
  'https://h.example/x?token=' + PW, '{"password":"' + PW + '"}', 'secret_key = "' + PW + '"', 'see the docs', 'Release2024', 'src/app/main', ':x-oauth-basic', 'Alternatively',
  'PGPASSWORD=' + PW2 + ' psql', 'password: ' + PW2, 'mysql -p' + PW2, '--password ' + PW2, 'export DB_PASSWORD="' + PW2 + '"'];
const LEADS = ['', 'see ', 'password=', 'x', 'Token:<br/>', '`', '**', '- [ ] ', 'page2\u2028', 'note\u200b', '> ', 'export T=', '[gh](https://h.example/' + 'a'.repeat(300) + ')', '[x](u) '];
const JOIN = ['', ' ', '\n', '\r\n', '\n\n', ', ', '<br>', '​'];

const mh = { redact: (x: string) => HEAD.redact(x, {}), cmd: (x: string) => HEAD.maskSecretCommand(x, {}), url: (x: string) => HEAD.maskSecretUrl(x, {}) };
const mr = { redact: (x: string) => REF.redact(x, {}), cmd: (x: string) => REF.maskSecretCommand(x, {}), url: (x: string) => REF.maskSecretUrl(x, {}) };
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
    const secrets = [PW, PW2];
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
      ['maskNoteText', HEAD.maskNoteText(t).text, REF.maskNoteText(t).text],
      ['maskOutgoing', HEAD.maskOutgoing(t).text, REF.maskOutgoing(t).text],
      ['redactMarkdown', HEAD.redactMarkdown(t, t.replace(/[*`~[\]]/g, ''), {}), REF.redactMarkdown(t, t.replace(/[*`~[\]]/g, ''), {})],
      ['permText other', LAH.permText(t, 'other', mh).text, LAR.permText(t, 'other', mr).text],
      ['permText shell', LAH.permText('run ' + t, 'shell', mh).text, LAR.permText('run ' + t, 'shell', mr).text],
      ['phrase', LAH.phrase({ kind: 'run', tool: 'Bash', label: t }, mh), LAR.phrase({ kind: 'run', tool: 'Bash', label: t }, mr)],
    ];
    for (const [surface, head, ref] of pairs) {
      // the tool phrase is cut at 160 characters: when main's phrase was cut, it hid the rest by length, not by a mask (this PR's masks can shorten what comes first)
      if (surface === 'phrase' && ref.endsWith('\u2026')) continue;
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
console.log(`redact monotone: all checks passed (${total} distinct cases, fourteen surfaces)`);
