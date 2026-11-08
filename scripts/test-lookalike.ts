/** Lookalike letters in a permission request (spec 003 FR-113..FR-116, T042..T044, issue #1300): the token rule, the scripts, compatibility forms,
 * mixed digits, the closed lookalike lists in name positions only, and hosts as the network reads them. `npm run test:lookalike`. No credits spent.
 * Made-up names only (`.invalid` hosts, invented programs); every non-ASCII character is a \u escape. */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { assertLinearShape } from './redact-growth-lib';

const R = path.join(__dirname, '..', '..', 'src', 'renderer');
type Finding = { token: string; index: number; char: string; cp: number; script: string; rule: string; marked: string };
type Host = { shown: string; ascii: string; index: number; end?: number };
type Look = { n?: number; findings?: Finding[]; hosts?: Host[]; inHidden?: boolean; unchecked?: boolean };
const L = require(path.join(R, 'lookalike.js')) as {
  check(t: unknown, kind: string): { findings: Finding[]; hosts: Host[] };
  line(l: Look | Look[]): string; marker(f: { cp: number; script: string }): string; hostOdd(h: Host): boolean; tipLen(t: string): number; PCTRL_T: RegExp; CAP: number; TIP_MAX: number;
};
let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepStrictEqual(a, b, m); n++; };
const cps = (t: string, k: string) => L.check(t, k).findings.map((f) => f.cp);
const rules = (t: string, k: string) => L.check(t, k).findings.map((f) => f.rule);
const none = (t: string, k: string, m: string) => eq(L.check(t, k).findings, [], m + ': ' + JSON.stringify(L.check(t, k).findings));

// T042 / FR-113: the same control set as spec 097 FR-318 (one source, two files: they must not drift)
{
  const live = fs.readFileSync(path.join(R, 'liveact.js'), 'utf8');
  const m = /const PCTRL_T=(\/.*?\/u);/.exec(live);
  ok(m && m[1] === String(L.PCTRL_T), 'lookalike.js reads the same control characters as liveact.js PCTRL_T');
  eq(L.CAP, 10000, 'the FR-318 cap');
}

// T042 / FR-114 (a): mixed scripts (UTS #39 moderately restrictive)
{
  const s1 = L.check('fetch https://exampl\u0435.invalid/x', 'other');
  eq(s1.findings.map((f) => [f.token, f.cp, f.script, f.rule]), [['exampl\u0435', 0x435, 'Cyrillic', 'mixed']], 'scenario 1: Latin + Cyrillic in one token warns');
  eq(s1.findings[0].index, 'fetch https://exampl'.length, 'the index is the letter in the text');
  eq(s1.findings[0].marked, 'exampl\u0435\u27e6U+0435 Cyrillic\u27e7', 'the marked token: the letter stays, the marker follows it');
  eq(cps('run durbtoo\u04cf --sync', 'shell'), [0x4cf], 'scenario 2: a Cyrillic palochka in a Latin program name');
  eq(cps('mcp srv-demo \u203a re\u0430d_notes', 'tool'), [0x430], 'scenario 3: a Cyrillic a in a tool name');
  eq(rules('read /x/\u0444\u0430\u0439\u03bb/y', 'other'), ['mixed'], 'Cyrillic + Greek in one token warns, in a path too');
  eq(cps('read /x/note\u13a0s', 'other'), [0x13a0], 'Latin + Cherokee warns');
  none('read /x/abc\u0628\u062a\u062b', 'other', 'Latin + Arabic (one other script) does not warn');
  eq(L.check('read /x/\u0628\u062a\u05d0\u05d1', 'other').findings.map((f) => [f.cp, f.rule]), [[0x5d0, 'mixed'], [0x5d1, 'mixed']], 'Arabic + Hebrew in one token warns (the letters not of the first script)');
  none('read /x/\u6f22\u5b57\u30c7\u30fc\u30bfnotes\u3072\u3089.txt', 'other', 'Japanese: Kanji + Katakana (with the prolonged mark) + Hiragana + Latin');
  none('read /x/\u4e2d\u6587\u3105\u3106abc', 'other', 'Latin + Han + Bopomofo');
  none('read /x/\ud55c\uae00\u6f22abc', 'other', 'Latin + Han + Hangul');
  // Script_Extensions, not Script: U+A8F3 is Script=Devanagari but Script_Extensions Devanagari and Tamil, so it sits in a Tamil word
  none('read /x/\u0b85\u0b95\ua8f3', 'other', 'scx: a letter shared by Tamil and Devanagari in a Tamil word');
  // Common is no script: U+02BB (Script_Extensions Common) inside a Cyrillic word
  none('read /x/\u043c\u02bb\u044f\u0441\u043e.txt', 'other', 'Common counts for no script');
  // the token rule: `-`, `.`, `/`, `\`, `_` separate tokens, the same for POSIX and Windows paths
  none('read /home/u/\u0444\u0430\u0439\u043b-notes.txt', 'other', 'a Cyrillic word and a Latin word joined by - are two tokens');
  none('write C:\\Users\\u\\\u0444\u0430\u0439\u043b_notes\\x.txt', 'other', 'a Windows path: \\ and _ separate');
  // scenario 8 and a control that would split the scripts apart: the controls go out first, so it is one token
  const s8 = L.check('run exa\u200bmpl\u0435', 'shell');
  eq(s8.findings.map((f) => [f.token, f.cp, f.index]), [['exampl\u0435', 0x435, 'run exa\u200bmpl'.length]], 'scenario 8: one token across a zero-width space; the index counts the control');
  eq(cps('read /x/exampl\u200b\u0435.txt', 'other'), [0x435], 'a zero-width space between the scripts does not make two tokens that pass');
  eq(cps('read /x/exampl\u2060\u00ad\u0435.txt', 'other'), [0x435], 'nor a word joiner and a soft hyphen');
  ok(L.check('run a\nexampl\u0435', 'shell').findings.length === 1, 'a line break separates, the next word is still checked');
}

// T042 / FR-114 (c): two digit systems in one token
{
  eq(L.check('run a1\u0662 x', 'shell').findings.map((f) => [f.cp, f.rule]), [[0x662, 'digits']], 'ASCII and Arabic-Indic digits in one program name');
  none('read /x/\u0645\u0644\u0641\u0661\u06622.txt', 'other', 'fix round 1: Arabic-Indic and ASCII digits in an Arabic file name do not warn');
  eq(rules('read /x/a\u0661\u06f2', 'other'), ['digits'], 'Arabic-Indic and Extended Arabic-Indic still warn in a path');
  none('read /x/\u0661\u0662\u0663', 'other', 'one digit system');
  none('read /x/report2026', 'other', 'ASCII digits');
  eq(rules('read /x/\u0966\u0967\u0e51', 'other').includes('digits'), true, 'Devanagari and Thai digits in one token');
}

// T043 / FR-114 (b): compatibility forms (NFKC differs from NFC)
{
  ok(rules('run \uff44\uff55\uff52\uff42 x', 'shell').every((r) => r === 'nfkc') && cps('run \uff44\uff55\uff52\uff42 x', 'shell').length === 4, 'fullwidth letters warn, each marked');
  eq(cps('read /x/notes\ud835\udc1d.txt', 'other'), [0x1d41d], 'a mathematical bold letter warns, in a path too');
  eq(rules('read /x/\ufb01le', 'other'), ['nfkc'], 'a ligature warns');
  eq(rules('run x\u00b2', 'shell'), ['nfkc'], 'a superscript warns in a program name');
  none('read /x/x\u00b2', 'other', 'fix round 1: a superscript in a path does not warn');
  eq(rules('read /x/\uff44\uff55\uff52\uff42', 'other'), [], 'fix round 1: width variants in a path do not warn');
  eq(rules('fetch https://\uff44\uff55\uff52\uff42.invalid/', 'other').length, 4, 'but they do in a host');
  none('read /x/caf\u00e9 r\u00e9sum\u00e9', 'other', 'composed accents are NFC and NFKC alike');
}

// T043 / FR-114 (d), FR-115: lookalike letters in one script, in name positions only (owner decision 2)
{
  eq(L.check('run durb\u0251tool', 'shell').findings.map((f) => [f.cp, f.rule]), [[0x251, 'lookalike']], 'scenario 5: Latin alpha in a program name');
  eq(cps('run d\u0131rbtool x', 'shell'), [0x131], 'scenario 5: dotless i in a program name');
  none('read /home/u/\u0131\u015f\u0131k/notes.txt', 'other', 'scenario 5: the same letter in a Turkish path does not warn');
  none('run durbtool /home/u/\u0131\u015f\u0131k/x', 'shell', 'nor in a path argument');
  // the closed Latin list: every range end and the single letters (a letter dropped from the list fails here)
  for (const cp of [0x131, 0x237, 0x1c0, 0x1c1, 0x1c2, 0x1c3, 0x250, 0x2af, 0x1d00, 0x1dbf, 0xa722, 0xa7ff, 0xab30, 0xab65]) {
    const c = String.fromCodePoint(cp);
    if (!/\p{L}/u.test(c)) continue;
    ok(L.check('run durb' + c + 'tool', 'shell').findings.some((f) => f.cp === cp), 'Latin lookalike U+' + cp.toString(16) + ' in a program name');
  }
  none('run caf\u00e9tool \u00f1and\u00fa \u00df \u00f8', 'shell', 'accented Latin never warns, also as a program name');
  // whole-script lookalikes: a Cyrillic-only or Greek-only name whose every letter looks Latin
  eq(rules('run \u0441\u043e\u0440\u0435 x', 'shell'), ['lookalike', 'lookalike', 'lookalike', 'lookalike'], 'scenario 6: a Cyrillic-only program name of Latin-looking letters');
  none('read /home/u/\u0441\u043e\u0440\u0435/x', 'other', 'scenario 6: a Cyrillic-only path segment does not warn');
  none('run durbtool \u043f\u0440\u0438\u0432\u0435\u0442 \u0441\u043e\u0440\u0435', 'shell', 'scenario 6: a Russian word and a Latin-looking Cyrillic word as arguments do not warn');
  none('run \u043f\u0440\u0438\u0432\u0435\u0442', 'shell', 'a Cyrillic program name with a letter that does not look Latin');
  const CYRL = [0x430, 0x441, 0x435, 0x4bb, 0x456, 0x458, 0x43e, 0x440, 0x455, 0x443, 0x445, 0x501, 0x51b, 0x51d, 0x4cf, 0x410, 0x412, 0x415, 0x41a, 0x41c, 0x41d, 0x41e, 0x420, 0x421, 0x422, 0x425, 0x405, 0x406, 0x408, 0x4ae, 0x51a, 0x51c, 0x4ba, 0x4c0];
  const GREK = [0x3bf, 0x3bd, 0x3b1, 0x3b9, 0x3ba, 0x3c5, 0x3c1, 0x391, 0x392, 0x395, 0x396, 0x397, 0x399, 0x39a, 0x39c, 0x39d, 0x39f, 0x3a1, 0x3a4, 0x3a5, 0x3a7];
  for (const cp of CYRL) eq(cps('run \u0441' + String.fromCodePoint(cp) + '\u043e', 'shell').length, 3, 'Cyrillic lookalike list has U+' + cp.toString(16));
  for (const cp of GREK) eq(cps('run \u03bf' + String.fromCodePoint(cp) + '\u03bf', 'shell').length, 3, 'Greek lookalike list has U+' + cp.toString(16));
  none('run \u03bb\u03bf\u03b3', 'shell', 'a Greek name with a letter that does not look Latin');
  // name positions: the first word and the first after each command separator; MCP server and tool names; a custom tool
  for (const sep of [' ; ', ' | ', ' && ', ' || ', ' & ', '\n', ' $(', ' `', ';', '|']) ok(L.check('run ls' + sep + '\u0441\u043e\u0440\u0435 x', 'shell').findings.length === 4, 'a program after ' + JSON.stringify(sep) + ' is a name');
  none('run ls \u0441\u043e\u0440\u0435', 'shell', 'an argument is not a name');
  none('\u0441\u043e\u0440\u0435 x', 'other', 'another kind: no program names');
  ok(L.check('mcp \u0441\u043e\u0440\u0435 \u203a x', 'tool').findings.length === 4, 'an MCP server name is a name');
  ok(L.check('mcp:srv/\u0441\u043e\u0440\u0435', 'tool').findings.length === 4, 'the mcp: key\'s tool is a name');
  ok(L.check('custom-tool durb\u0251', 'tool').findings.length === 1, 'a custom tool name is a name');
  // scenario 7: clean text, nothing found
  for (const t of ['run npm test', 'write C:\\Users\\u\\Documents\\\u041e\u0442\u0447\u0451\u0442\u044b\\', 'read /home/u/\u03b1\u03c1\u03c7\u03b5\u03af\u03bf.txt', 'read /home/u/\u0645\u0644\u0641.txt',
    'read /home/u/\u0926\u0938\u094d\u0924\u093e\u0935\u0947\u091c\u093c.txt', 'read /home/u/\u8cc7\u6599\u30c7\u30fc\u30bfv2.txt', 'write caf\u00e9/men\u00fa.md', 'run durbtool --name \u043f\u0440\u0438\u0432\u0435\u0442'])
    none(t, /^run /.test(t) ? 'shell' : 'other', 'scenario 7: ' + t);
}

// T044 / FR-116: hosts as the network reads them
{
  const h1 = L.check('fetch https://exampl\u0435.invalid/x', 'other').hosts;
  eq(h1, [{ shown: 'exampl\u0435.invalid', ascii: 'xn--exampl-8of.invalid', index: 'fetch https://'.length, end: 'fetch https://exampl\u0435.invalid'.length }], 'scenario 1: the host and its punycode');
  ok(L.hostOdd(h1[0]), 'a punycode host is named');
  ok(/host is xn--exampl-8of\.invalid:/.test(L.line({ hosts: h1 })), 'the line names the host as the network reads it: ' + L.line({ hosts: h1 }));
  ok(!L.line({ hosts: h1 }).includes('host is exampl\u0435'), 'never the Unicode host as the host');
  eq(L.check('run curl -s https://user@exampl\u0435.invalid:8443/a?b', 'shell').hosts.map((h) => [h.shown, h.ascii]), [['exampl\u0435.invalid', 'xn--exampl-8of.invalid']], 'a URL inside a shell command, userinfo and port left out');
  eq(L.check('mcp srv \u203a get https://exampl\u0435.invalid', 'tool').hosts.length, 1, 'a URL in another kind of text');
  const xn = L.check('fetch https://xn--exampl-8of.invalid/', 'other').hosts;
  ok(xn.length === 1 && L.hostOdd(xn[0]), 'a host already written in punycode is named too');
  const fw = L.check('fetch https://\uff45\uff58\uff41\uff4d\uff50\uff4c\uff45.invalid/', 'other');
  eq(fw.hosts.map((h) => h.ascii), ['example.invalid'], 'scenario 4: fullwidth folded to what URL reads');
  ok(fw.findings.length === 7 && fw.findings.every((f) => f.rule === 'nfkc'), 'scenario 4: and each fullwidth letter is a finding');
  const bad = L.check('fetch https://exa^mpl\u0435.invalid/', 'other');
  ok(bad.findings.some((f) => f.rule === 'host' && f.token === 'exa^mpl\u0435.invalid') && bad.hosts.length === 0, 'a host URL refuses is a finding of its own');
  ok(!L.hostOdd({ shown: 'Example.invalid', ascii: 'example.invalid', index: 0 }), 'a case difference is not a lookalike');
  eq(L.check('fetch xn--exampl-8of.invalid', 'other').hosts.map((h) => h.ascii), ['xn--exampl-8of.invalid'], 'the bare host of a url grant label');
  // a lookalike list letter in a host label is a name position
  eq(cps('fetch https://durb\u0251.invalid/', 'other'), [0x251], 'FR-114 (d) applies to a host label');
}

// FR-118: the line (at most 5 findings, then "and N more"; hidden part; could not check)
{
  const f = L.check('run durbtoo\u04cf --sync', 'shell').findings;
  eq(L.line({ findings: f }), 'Lookalike letters: "durbtoo\u04cf\u27e6U+04CF Cyrillic\u27e7" has U+04CF, a Cyrillic letter, not the Latin one. Check the name before you allow it.', 'the line');
  const many = L.check('read /x/a\u0430 b\u0431 c\u0432 d\u0433 e\u0434 f\u0436 g\u0437', 'other').findings;
  ok(/; and 2 more\. Check the name/.test(L.line({ findings: many })) && L.line({ findings: many }).split('" has ').length === 6, 'at most 5, then and N more: ' + L.line({ findings: many }));
  eq(L.line({ inHidden: true, findings: [] }), 'There are lookalike letters in the hidden part too.', 'the hidden part');
  eq(L.line({ unchecked: true }), 'Durbar could not check this request for lookalike letters.', 'could not check');
  eq(L.line([]), '', 'nothing: no line');
}

// FR-113: bounded: the cap, and linear time by CPU on 10000 characters (no backtracking over the input)
{
  ok(L.check('x'.repeat(20000) + ' exampl\u0435', 'other').findings.length === 0, 'past the cap nothing is read');
  const shapes: [string, string][] = [['mixed tokens', 'a\u0430\u03b1\u0661 '], ['one long token', 'a\u0430'], ['schemes', 'https://exampl\u0435.invalid/ '], ['separators', ' | $(`\u0441'], ['digits', '1\u0661\u0967'], ['controls', 'a\u200b\u0430']];
  for (const [label, unit] of shapes) assertLinearShape('lookalike ' + label, (x) => { L.check(x, 'shell'); L.check(x, 'other'); }, (k) => unit.repeat(Math.ceil(k / unit.length)).slice(0, k), 10000);
}

// fix round 1 (#1300 review): hosts without a scheme in a shell command (FR-116)
{
  const P = '\u0440\u0430\u0443\u0440\u0430\u04cf'; // made-up Cyrillic letters that read like a Latin word
  for (const [t, host] of [['run curl ' + P + '.invalid/x', P + '.invalid'], ['run ssh u@' + P + '.invalid', P + '.invalid'], ['run scp f ' + P + '.invalid:/x', P + '.invalid'], ['run git clone git@' + P + ':repo', P], ['run curl ' + P + '.invalid:8443/x', P + '.invalid']] as const) {
    const r = L.check(t, 'shell');
    eq(r.hosts.map((h) => h.shown), [host], 'a host without a scheme: ' + t);
    ok(L.hostOdd(r.hosts[0]) && r.findings.length === 6 && r.findings.every((f) => f.rule === 'lookalike'), 'its labels are names (FR-114 (d)) and it gets the punycode line: ' + t);
  }
  for (const t of ['run cp a.txt v1.2.3 foo.tar.gz notes.v2.md /tmp/x', 'run tar -C foo.tar.gz/ -xf b.zip', 'run cp \u043e\u0442\u0447\u0451\u0442.txt d/', 'run python -m pkg.mod:main', 'run cp C:\\x\\y.txt D:/z']) {
    const r = L.check(t, 'shell');
    ok(r.findings.length === 0 && !r.hosts.some(L.hostOdd), 'ordinary file names give no warning as hosts: ' + t + ' ' + JSON.stringify(r));
  }
  none('read /x/' + P + '.invalid/y', 'other', 'a path of another kind is not a host');
}
// fix round 1: Latin in a forbidden mix: the other script's letters are marked, not the Latin one
{
  const r = L.check('fetch https://\u0440\u0430\u0443\u0440\u0430l.invalid/', 'other');
  ok(r.findings.length === 5 && r.findings.every((f) => f.script === 'Cyrillic' && f.rule === 'mixed') && !r.findings.some((f) => f.char === 'l'), 'the Cyrillic letters are marked, not the l: ' + JSON.stringify(r.findings.map((f) => f.cp)));
  eq(cps('run durbtoo\u04cf', 'shell'), [0x4cf], 'a Latin name with one Cyrillic letter: that letter');
}
// fix round 1: real non-Latin names in paths and arguments never warn (Paco): 35 made-up file and folder names in many scripts
{
  const words = ['\u043e\u0442\u0447\u0451\u0442', '\u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u044b', '\u041f\u0440\u0438\u0432\u0435\u0442', '\u043f\u0440\u043e\u0435\u043a\u0442', '\u0131\u015f\u0131k', '\u00c7al\u0131\u015fma', '\u00f6\u011frenci', '\u015eirket', '\u0645\u0644\u0641', '\u062a\u0642\u0631\u064a\u0631', '\u0627\u0644\u0645\u0634\u0631\u0648\u0639', '\u03b1\u03c1\u03c7\u03b5\u03af\u03bf', '\u0388\u03b3\u03b3\u03c1\u03b1\u03c6\u03b1', '\u03c6\u03ac\u03ba\u03b5\u03bb\u03bf\u03c2', '\u0926\u0938\u094d\u0924\u093e\u0935\u0947\u091c\u093c', '\u092b\u093c\u093e\u0907\u0932', '\u092a\u0930\u093f\u092f\u094b\u091c\u0928\u093e', '\ubb38\uc11c', '\ubcf4\uace0\uc11c', '\ud55c\uae00\ud30c\uc77c', '\u8cc7\u6599\u30c7\u30fc\u30bf', '\u6771\u4eac\u30ce\u30fc\u30c8', '\u3072\u3089\u304c\u306a\u30ab\u30bf\u30ab\u30ca\u6f22\u5b57', '\u5199\u771f\uff71\uff99\uff8a\uff9e\uff91', '\u05de\u05e1\u05de\u05da', '\u0e40\u0e2d\u0e01\u0e2a\u0e32\u0e23', '\u6587\u4ef6\u5939', '\u0583\u0561\u057d\u057f\u0561\u0569\u0578\u0582\u0572\u0569', '\u10d3\u10dd\u10d9\u10e3\u10db\u10d4\u10dc\u10e2\u10d8', 't\u00e0i li\u1ec7u', '\u043c\u02bc\u044f\u0441\u043e', '\u0395\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac2024', '\ub370\uc774\ud130\uff12', '\uff83\uff9e\uff70\uff80', '\u8cc7\u6599\uff11'];
  eq(words.length, 35, 'the corpus');
  for (const w of words) {
    none('read /home/u/' + w + '/' + w + '.txt', 'other', 'POSIX path: ' + w);
    none('write C:\\Users\\u\\' + w + '\\notes.md', 'other', 'Windows path: ' + w);
    none('run durbtool --out ' + w + ' ' + w + '.md', 'shell', 'shell argument: ' + w);
  }
  none('run echo m\u00b2', 'shell', 'echo m with a superscript two');
  none('read /x/\ufe43\uff83\uff9e\uff70\uff80.txt', 'other', 'halfwidth katakana');
}
// fix round 1: bounded and linear: one long token full of findings, and many tokens; the line and the tooltip length stay small
{
  const CT = require(path.join(R, 'cuttext.js')) as { cutText(t: string, n: number): string };
  const long = (k: number) => 'run ' + '\uff41'.repeat(k);
  const many = (k: number) => 'run x ' + 'a\u0430 '.repeat(Math.ceil(k / 3)).slice(0, k);
  ok(L.line(L.check(long(9990), 'shell')).length < 600, 'the line of 9990 flagged letters is short: ' + L.line(L.check(long(9990), 'shell')).length);
  ok(L.line(L.check(many(9990), 'shell')).length < 1200, 'the line of thousands of tokens is short');
  const abc = L.line(L.check('run ' + Array.from({ length: 26 }, (_, i) => String.fromCodePoint(0xff41 + i)).join(''), 'shell'));
  ok(abc.includes('has U+FF41, U+FF42, U+FF43 and 23 more,'), 'a token with 26 distinct flagged letters names 3 and counts the rest: ' + abc);
  for (const [label, make] of [['one long token', long], ['many tokens', many], ['dotted hosts', (k: number) => 'run ' + 'a\u0430.b/ u@\u0430.c '.repeat(Math.ceil(k / 16)).slice(0, k)], ['one long dotted word', (k: number) => 'run ' + 'a.'.repeat(Math.ceil(k / 2)).slice(0, k)]] as const)
    assertLinearShape('line ' + label, (x) => { L.line(L.check(x, 'shell')); }, make, 10000);
  const tip = (t: string) => CT.cutText(t, L.tipLen(t));
  ok(Array.from(tip('run x ' + 'a\u27e6U+0430 Cyrillic\u27e7'.repeat(500))).length <= L.TIP_MAX, 'the tooltip has a hard cap');
  eq(L.tipLen('run x'), 240, 'a short text: 240');
  assertLinearShape('tooltip', (x) => { tip(x); }, (k) => ('a\u27e6U+0430 Cyrillic\u27e7 ').repeat(Math.ceil(k / 20)).slice(0, k), 10000);
}
// fix round 2 (#1300 re-review): a host without a scheme only as an argument of a network program, never in quotes, never a version
{
  const P = '\u0440\u0430\u0443\u0440\u0430\u04cf';
  for (const [t, host] of [['run scp f user:pw@' + P + '.invalid:/x', P + '.invalid'], ['run sudo ssh ' + P + '.invalid', P + '.invalid'], ['run git clone git@' + P + ':repo', P], ['run rsync -a d/ ' + P + '.invalid:/x', P + '.invalid'], ['run git push ' + P + '.invalid:repo', P + '.invalid']] as const)
    eq(L.check(t, 'shell').hosts.map((h) => h.shown), [host], 'a network program\'s host: ' + t);
  for (const t of ['run npm i pkg@1.2.3', 'run cat \u0444\u0430\u0439\u043b.txt:12', 'run cp x \u8cc7\u6599.bak/', 'run python3 \u0441\u043a\u0440\u0438\u043f\u0442.py/x', 'run docker run \u0438\u043c\u044f.io/x',
    'run cp a \u0441\u043e\u0440.d/x', 'run git commit -m "see git@' + P + '.invalid:x"', 'run git config user.email a@' + P + '.example', 'run grep x file.tar.gz:3', 'run cp C:\\x\\y.txt D:/z',
    'run node -e "require(\'node:fs\')"', 'run echo "http: ' + P + '.invalid/x"', 'run tar xf \u0430\u0440\u0445\u0438\u0432.tar.gz', 'run git push origin main:\u0432\u0435\u0442\u043a\u0430', 'run git add \u043f\u0430\u043f\u043a\u0430.old/x', 'run scp \u043f\u0430\u043f\u043a\u0430.old/x h.invalid:/y', 'run curl -o \u0444\u0430\u0439\u043b.txt https://ok.invalid/', 'run curl -d "' + P + '.invalid/x" https://ok.invalid/', 'run curl -u a@1.2.3 https://ok.invalid/']) {
    const r = L.check(t, 'shell');
    ok(r.findings.length === 0 && r.hosts.filter(L.hostOdd).length === 0, 'stays clean (no host line, no rule (d)): ' + t + ' ' + JSON.stringify(r));
  }
}
// fix round 3 (#1300 delta check): escaped quotes, wrappers with options, git -C, substitutions; the clean corpus stays clean
{
  const P = '\u0440\u0430\u0443\u0440\u0430\u04cf', H = ' ssh ' + P + '.invalid';
  for (const t of ['run echo "a\\"b" ;' + H, "run echo 'a\\' ;" + H, 'run echo a\\"b ;' + H, "run echo a\\'b ;" + H, 'run echo "a\\\'b" ;' + H, 'run echo "\\\\" ;' + H, 'run echo "\\"";' + H, 'run echo \\\\"x" ;' + H,
    'run sudo -u root' + H, 'run nice -n 10' + H, 'run timeout 5s' + H, 'run xargs -I x' + H, 'run watch -n 2' + H, 'run strace -e trace=x' + H, 'run kubectl exec x --' + H, 'run docker exec -it c --' + H,
    'run ssh $(echo) ' + P + '.invalid', 'run echo $(' + H.slice(1) + ')', 'run echo `' + H.slice(1) + '`', 'run env A=1 sudo -E' + H])
    ok(L.check(t, 'shell').hosts.some((h) => h.shown === P + '.invalid'), 'the host is found: ' + t);
  eq(L.check('run git -C d clone ' + P + '.invalid:r', 'shell').hosts.map((h) => h.shown), [P + '.invalid'], 'git -C d clone');
  eq(L.check('run git -c a=b --git-dir x fetch ' + P + '.invalid:r', 'shell').hosts.map((h) => h.shown), [P + '.invalid'], 'git -c a=b --git-dir x fetch');
  for (const t of ['run echo ssh is great', 'run grep ssh file.txt:3', 'run grep ssh \u0444\u0430\u0439\u043b.txt:3', 'run man ssh', 'run cat ssh.conf/x', 'run git log --grep=clone a.b:c', 'run git log --grep=clone \u0444\u0430\u0439\u043b.b:c',
    'run sshd -D ' + P + '.invalid', 'run my-ssh ' + P + '.invalid', 'run echo \\', 'run echo "\\\\"x', 'run echo "ssh ' + P + '.invalid"', 'run sudo cp ssh ' + P + '.invalid:/x']) {
    const r = L.check(t, 'shell');
    ok(r.findings.length === 0 && !r.hosts.some(L.hostOdd), 'stays clean: ' + t + ' ' + JSON.stringify(r.hosts));
  }
  assertLinearShape('nested substitutions', (x) => { L.check(x, 'shell'); }, (k) => 'run ' + '$('.repeat(Math.ceil(k / 2)).slice(0, k), 10000);
  assertLinearShape('backslashes and quotes', (x) => { L.check(x, 'shell'); }, (k) => 'run ' + '\\"a\'\\\\ `$(x) ssh a.b:c ;'.repeat(Math.ceil(k / 24)).slice(0, k), 10000);
}
// fix round 4 (#1300): quoted or escaped program names, shell keywords and groups, comments (the reviewer's inputs)
{
  const C = 'раураӏ.invalid';
  for (const t of ['"ssh" ' + C, "'ssh' " + C, '"ss"h ' + C, 's\\sh ' + C, "$'ssh' " + C, "$'s\\sh' " + C, 'ss\\\nh ' + C, 'ssh \\\n' + C, '{ ssh ' + C + '; }', 'if true; then ssh ' + C + '; fi', '! ssh ' + C,
    'while true; do ssh ' + C + '; done', '"sudo" -u root ssh ' + C, 'echo a#b ; ssh ' + C, 'ls #"\nssh ' + C, "ls #'\nssh " + C, 'echo # x\nssh ' + C, "echo '#' ; ssh " + C, 'ssh u@' + C + '#x'])
    ok(L.check('run ' + t, 'shell').hosts.some((h) => h.shown === C), 'the host is found: ' + JSON.stringify(t));
  for (const t of ['echo "ssh" ' + C, '# ssh ' + C, 'echo if ssh ' + C, 'echo { ssh ' + C, 'ls # "\nls ' + C, 'echo "x ; ssh ' + C + ' y"', "echo 'x ; ssh " + C + " y'", "echo \"ssh $'x'\" " + C])
    ok(!L.check('run ' + t, 'shell').hosts.some(L.hostOdd) && L.check('run ' + t, 'shell').findings.length === 0, 'stays clean: ' + JSON.stringify(t));
  eq(L.check("run ssh $'" + C + "'", 'shell').hosts, [], 'a quoted host is not read (spec 003 known gap)');
  eq(L.check('run ssh "u"@' + C, 'shell').hosts, [], 'nor a host after a quoted user (spec 003 known gap)');
}
console.log(`lookalike: ${n} checks passed`);
