/**
 * Spec 095 T065 (issue 1234): the differential fuzz of `maskOutgoing`/`maskNoteText` against the reference (`maskKeepingMarkdownReference`,
 * the copy pass always), apart from `test-maskoutgoing.ts` so the quick rule cases stay quick (review of PR 1244, item 6; FR-048b). Seeded,
 * no credits. What the new masks still show (the text without its masks and spaces) is a subsequence of what the reference shows, so nothing
 * the reference hides can become readable.
 */
import * as assert from 'assert';
import { HIDDEN_CHARS, hiddenCanHide, maskKeepingMarkdownReference, maskNoteText, maskOutgoing } from '../src/shared/redact';
import { CORPUS, V1, V2 } from './maskoutgoing-corpus';

// issue 1234 (spec 095 T065): an inert hidden character (between two non-ASCII, non-space characters) skips the copy pass. Seeded
// differential fuzz against the reference (the masks as before: the copy pass always): what the new masks still show (the text without
// its masks and spaces) is a subsequence of what the reference shows, so nothing the reference hides can become readable; most are
// identical (the reference may hide a space or a neighbour more, never less). Tokens are cut by hidden characters of every class, alone, next to emoji, after long text.
{
  const savedEnv = { ...process.env }; // the fuzz does not depend on the machine: no secret-like variable (a space in one changed the rule)
  for (const k of Object.keys(process.env)) delete process.env[k];
  const part = process.argv[2] === 'b' ? 'b' : 'a'; // two suites, each under about 30 s on CI (review of PR 1244, round 2): the same fuzz, two seeds, N each halved; part b also runs the rule cases
  let seed = part === 'b' ? 0x2345c : 0x1234b;
  const rnd = (): number => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const hiddenAll: string[] = [];
  for (let cp = 0; cp < 0x110000; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const ch = String.fromCodePoint(cp);
    if (HIDDEN_CHARS.test(ch) && (cp < 0x3000 || cp > 0xe0000 || cp % 7 === 0 || cp === 0xfe0f || cp === 0xfeff)) hiddenAll.push(ch);
  }
  const hidden = ['\u200d', '\u200b', '\ufe0f', '\u{e0041}', '\u00ad', '\u2060', '\u200c', ...hiddenAll.slice(0, 40), pick(hiddenAll)];
  const emoji = ['\u{1F600}', '\u{1F468}', '\u{1F4BB}', '\u2764', '\u26a0', '\u{1F3F4}', '\u{1F1E9}'];
  const letters = ['\u00e9', '\u00fc', '\u0436', '\u0915', '\u0937', '\u65e5', '\u672c', '\u03b1', '\u0627'];
  const wide = ['\uff21', '\uff47', '\uff48', '\uff50', '\uff3f', '\uff10', '\uff0a', '\uff40'];
  const combining = ['\u0301', '\u0308', '\u0338', '\u20e3', '\u064b'];
  const surrogate = ['\ud83d', '\ude00', '\udc68'];
  const spaces = [' ', ' ', '\n', '\t', '\u00a0', '\u3000', '\u2003'];
  const marks = ['**', '`', '~~', '[', ']', '\\', '_'];
  const tokens = CORPUS.map(([, v]) => v);
  const words = ['hello', 'release_notes', 'the build', 'password:', 'Bearer', 'invoice', 'a1B2c3', '2026-11-07'];
  const vals = [V1, V2, 'caf\u00e9-secret-99', 'plain-secret-abcd'];
  const piece = (): string => {
    const r = rnd();
    if (r < 0.2) { // a token cut once or twice by hidden characters, or marks
      const t = pick(tokens);
      const cut = (x: string): string => { const i = 1 + Math.floor(rnd() * (x.length - 1)); return x.slice(0, i) + pick(rnd() < 0.7 ? hidden : marks) + x.slice(i); };
      return rnd() < 0.3 ? cut(cut(t)) : cut(t);
    }
    if (r < 0.3) return pick(tokens);
    if (r < 0.42) return pick(emoji) + pick(hidden) + pick(emoji);
    if (r < 0.5) return pick(letters) + pick(hidden) + pick(letters);
    if (r < 0.56) return pick(wide) + pick(hidden) + pick(wide);
    if (r < 0.6) return pick(combining) + pick(hidden) + pick(letters);
    if (r < 0.64) return pick(surrogate) + pick(hidden) + pick(surrogate);
    if (r < 0.68) return pick(hidden);
    if (r < 0.74) return pick(marks);
    if (r < 0.8) return pick(emoji) + pick(['\ufe0f', '']) + pick(wide) + pick(letters);
    if (r < 0.86) return pick(vals).slice(0, 3 + Math.floor(rnd() * 8)) + pick(hidden) + pick(vals).slice(3);
    if (r < 0.9) return pick(vals);
    if (r < 0.96) return pick(words);
    return pick(letters) + pick(letters);
  };
  const shown = (x: string): string => x.split(/\[redacted(?::[^\]\r\n]{1,128})?\]/).join('').replace(/\s/g, '');
  const subseq = (small: string, big: string): boolean => { let j = 0; for (let i = 0; i < big.length && j < small.length; i++) if (big[i] === small[j]) j++; return j === small.length; };
  {
    let same = 0;
    let gap = 0;
    const unhideText = (x: string): string => x.replace(new RegExp(HIDDEN_CHARS.source, 'gu'), '');
    const N = 16_000;
    let live = 0;
    let inert = 0;
    let masked = 0;
    for (let n = 0; n < N; n++) {
      let t = rnd() < 0.1 ? 'Some long plain words about nothing in particular. '.repeat(1 + Math.floor(rnd() * 40)) : '';
      for (let k = 1 + Math.floor(rnd() * 7); k > 0; k--) t += piece() + pick(spaces).repeat(rnd() < 0.5 ? 1 : 0);
      const values = rnd() < 0.4 ? [pick(vals), pick(vals)] : [];
      const a = maskOutgoing(t, values);
      const b = maskKeepingMarkdownReference(t, values);
      if (a.text === b.text) same++;
      assert.strictEqual(a.changed, b.changed, `fuzz ${n}: changed as the reference for ${JSON.stringify(t)}`);
      // `redact` leaves a token glued to another token (`AKIA...sk-ant-...`) readable with no hidden character at all; the reference hid it
      // by accident, as its union of spans hides more than the copy found. That is not a hidden character's doing: tolerated only when the
      // text without them, masked as the reference does, shows what the new masks show (`gap`, counted and printed).
      const plain = unhideText(t);
      if (!subseq(shown(a.text), shown(b.text))) {
        assert.ok(plain !== t && subseq(unhideText(shown(a.text)), shown(maskKeepingMarkdownReference(plain, values).text)), `fuzz ${n}: nothing the reference hides is shown: ${JSON.stringify(t)} -> ${JSON.stringify(a.text)} (reference ${JSON.stringify(b.text)})`);
        gap++;
      }
      assert.deepStrictEqual(maskNoteText(t, values), a, `fuzz ${n}: maskNoteText too`);
      if (HIDDEN_CHARS.test(t)) { if (hiddenCanHide(t, values)) live++; else inert++; }
      if (b.changed) masked++;
    }
    assert.ok(inert >= 1000 && live >= 1000 && masked >= 3000, `the fuzz exercises both paths and masks (inert ${inert}, live ${live}, masked ${masked})`);
    console.log(`mask outgoing fuzz: ${N} texts, none shows what the reference hides except ${gap} glued-token gaps the hidden-free text has too (${same} identical, inert ${inert}, live ${live}, masked ${masked})`);
  }
  if (part === 'b') {
    // the new guards (review of PR 1244): a long non-ASCII value after a secret name, and an env secret with a space
    {
      const long = 'password=' + '\u00e9'.repeat(64) + '\u200d' + '\u00e9'.repeat(64) + '1';
      assert.strictEqual(maskKeepingMarkdownReference(long, []).changed, true, 'the reference masks the 129-character value');
      assert.strictEqual(maskOutgoing(long, []).changed, true, 'maskOutgoing masks it too: a hidden character in a named value is live');
      assert.strictEqual(hiddenCanHide(long, [], {}), true, 'a secret name with a separator makes every hidden character live');
      assert.strictEqual(hiddenCanHide('\u00e9\u200d\u00e9', [], {}), false, 'no secret name: still inert');
      // seeded long-value fuzz: names, separators, values over 128 characters of non-ASCII letters, emoji, the hidden character anywhere, the digit anywhere
      const names = ['password', 'token', 'API_KEY', 'client_secret', 'Passwd', '"secret"', 'pass', 'auth_key'];
      const seps = ['=', ': ', ':=', '=>', '%3D', ' = '];
      const vbits = ['\u00e9', '\u0436', '\u65e5', '\u{1F600}', '\u03b1', 'a', 'Z'];
      for (let n = 0; n < 4000; n++) {
        let v = '';
        const len = 100 + Math.floor(rnd() * 100);
        const bit = pick(vbits);
        for (let k = 0; k < len; k++) v += rnd() < 0.9 ? bit : pick(vbits);
        const at = Math.floor(rnd() * v.length);
        v = v.slice(0, at) + pick(hidden) + v.slice(at);
        if (rnd() < 0.8) { const d = Math.floor(rnd() * v.length); v = v.slice(0, d) + String(Math.floor(rnd() * 10)) + v.slice(d); }
        const t = (rnd() < 0.3 ? 'note: ' : '') + pick(names) + pick(seps) + v + pick(['', ' tail', '\n']);
        const a = maskOutgoing(t, []);
        const b = maskKeepingMarkdownReference(t, []);
        assert.strictEqual(a.changed, b.changed, `long fuzz ${n}: changed as the reference for ${JSON.stringify(t)}`);
        assert.ok(subseq(shown(a.text), shown(b.text)), `long fuzz ${n}: nothing the reference hides is shown: ${JSON.stringify(t)}`);
      }
      // the independent audit of PR 1244: bounded windows over non-ASCII classes in the other rule families (one repro per `LIVE_HEAD` alternative)
      const Z = '\u200d';
      const pad = (n: number): string => ('\u00e9' + Z).repeat(n) + '\u00e9';
      const PW = 'Hunter2' + 'pass99';
      const audit: Record<string, string> = {
        netrc_host: `machine ${pad(130)} login bob password ${PW}`,
        netrc_login: `machine example.org login ${pad(70)} password ${PW}`,
        curl_window: `curl "${pad(110)}" -u bob:${PW} https://x.test`,
        curl_user: `curl -u ${pad(70)}:${PW} https://x.test`,
        curl_window_nourl: `curl "${pad(110)}" -u bob:${PW}`,
        curl_user_nourl: `curl -u ${pad(70)}:${PW}`,
        url_user: `https://${pad(110)}:${PW}@x.test/`,
        url_pass: `https://bob:${pad(110)}@x.test/`,
        json_cookie: `{"Cookie": "${pad(70)}=${PW}"}`,
        cookie_hdr: `Cookie: ${pad(70)}=${PW}`,
      };
      for (const [k, t] of Object.entries(audit)) {
        const a = maskOutgoing(t, []);
        const b = maskKeepingMarkdownReference(t, []);
        assert.strictEqual(a.changed, true, `audit ${k}: masked (not only as the reference does: review of PR 1244, item 4)`);
        assert.strictEqual(b.changed, true, `audit ${k}: the reference masks it`);
        assert.ok(!a.text.includes(PW), `audit ${k}: the secret is gone`);
        assert.strictEqual(a.changed, b.changed, `audit ${k}: changed as the reference`);
        assert.ok(subseq(shown(a.text), shown(b.text)), `audit ${k}: nothing the reference hides is shown`);
        assert.strictEqual(hiddenCanHide(t, [], {}), true, `audit ${k}: LIVE_HEAD makes the hidden characters live`);
      }
      // seeded structural templates: a non-ASCII run (with joiners) in the host, user, cookie name or curl argument, all window sizes
      const run = (): string => { const n = 20 + Math.floor(rnd() * 150); let r = 'x'; for (let k = 0; k < n; k++) r += pick(['\u00e9', '\u0436', '\u65e5']) + (rnd() < 0.5 ? pick(hidden) : ''); return r; };
      const tpl: Array<() => string> = [
        () => `machine ${run()} login bob password ${PW}`,
        () => `machine example.org login ${run()} password ${PW}`,
        () => `curl "${run()}" -u bob:${PW} https://x.test`,
        () => `curl -u ${run()}:${PW} https://x.test`,
        () => `curl -u ${run()}:${PW}`,
        () => `curl "${run()}" -u bob:${PW}`,
        () => `https://${run()}:${PW}@x.test/`,
        () => `https://bob:${run()}@x.test/`,
        () => `{"Cookie": "${run()}=${PW}"}`,
        () => `Cookie: ${run()}=${PW}`,
        () => `Set-Cookie: ${run()}=${PW}; Path=/`,
      ];
      // Markdown marks inside a rule head (`maskCore` also reads the text without marks; review of PR 1244, item 1)
      const marked = (t: string): string => t.replace('Cookie', 'Coo**kie**').replace('machine', 'mach**ine**').replace('://', ':**//**');
      const heads = ['pass**word**=', '**Password**: ', 'api\\_key=', 'password**=**', 'pass`word`=', '**token**=', 'client**_**secret=', '[secret]: ', '~~passwd~~='];
      for (let k = 0; k < 9; k++) tpl.push(() => marked(tpl[k]()));
      tpl.push(() => `${pick(heads)}${run()}1`, () => `{"${pick(['Coo**kie**', '**Cookie**'])}": "${run()}=${PW}"}`, () => `mach**ine** ${run()} login bob password ${PW}`, () => `https:**//**${run()}:${PW}@x.test/`);
      for (let n = 0; n < 3000; n++) {
        const t = pick(tpl)();
        const a = maskOutgoing(t, []);
        const b = maskKeepingMarkdownReference(t, []);
        assert.strictEqual(a.changed, b.changed, `template fuzz ${n}: changed as the reference for ${JSON.stringify(t)}`);
        assert.ok(subseq(shown(a.text), shown(b.text)), `template fuzz ${n}: nothing the reference hides is shown: ${JSON.stringify(t)}`);
      }
      // an env secret with a space (VS Code sets GIT_ASKPASS to such a path on macOS and Windows) leaves the rule as with none
      for (const e of [{ GIT_ASKPASS: '/a b/askpass.sh' }, { API_TOKEN: 'my secret value 12' }, { GIT_ASKPASS: '/Users/a b/Library/askpass.sh', VSCODE_GIT_ASKPASS_NODE: 'C:\\Program Files\\Code\\Code.exe' }]) {
        for (const t of ['\u2764\ufe0f\u{1F600}', '\u00e9\u200d\u00e9', 'gh\u200dp', '\u00e9\u200d x']) {
          assert.strictEqual(hiddenCanHide(t, [], e), hiddenCanHide(t, [], {}), `env ${Object.keys(e)[0]} with a space: same rule for ${JSON.stringify(t)}`);
        }
        const saved = { ...process.env };
        for (const k of Object.keys(process.env)) delete process.env[k];
        Object.assign(process.env, e);
        try {
          const t = '\u00e9\u200d\u00e9 ' + Object.values(e)[0] + ' \u{1F600}\u200d\u{1F600}';
          const a = maskOutgoing(t, []);
          const b = maskKeepingMarkdownReference(t, []);
          assert.ok(a.changed && b.changed && subseq(shown(a.text), shown(b.text)) && !a.text.includes(Object.values(e)[0]), 'a space-valued env secret: masked, nothing the reference hides is shown');
        } finally {
          for (const k of Object.keys(process.env)) delete process.env[k];
          Object.assign(process.env, saved);
        }
      }
    }
  }
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, savedEnv);
}
