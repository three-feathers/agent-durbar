/** Markdown rendering and XSS tests (jsdom, no credits): `npm run test:markdown`. See specs/016. */
import * as assert from 'assert';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any

const root = path.join(__dirname, '..', '..');
const { window } = new JSDOM('<!doctype html><html><body></body></html>');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const createPurify = require('dompurify');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const marked = require('marked');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const create = require(path.join(root, 'src', 'renderer', 'markdown.js'));
const purify = (createPurify.default ?? createPurify)(window);
const md = create(marked, purify) as { render(t: string): string; MAX_CHARS: number };
const html = (t: string): string => md.render(t);
const dom = (t: string): Document => new JSDOM('<body>' + html(t) + '</body>').window.document;

// formatting
assert.match(html('**bold** and *it* and `code`'), /<strong>bold<\/strong> and <em>it<\/em> and <code>code<\/code>/);
assert.match(html('# Title\n\n## Sub'), /<h1>Title<\/h1>[\s\S]*<h2>Sub<\/h2>/);
assert.match(html('- a\n- b\n\n1. x\n2. y'), /<ul>[\s\S]*<li>a<\/li>[\s\S]*<\/ul>[\s\S]*<ol>[\s\S]*<li>y<\/li>/);
assert.match(html('> quoted'), /<blockquote>[\s\S]*quoted/);
assert.match(html('```js\nconst a = 1 < 2;\n```'), /<pre><code[^>]*>const a = 1 &lt; 2;/);
assert.match(html('| a | b |\n|---|:-:|\n| 1 | 2 |'), /<table>[\s\S]*<th>a<\/th>[\s\S]*<td[^>]*>2<\/td>/);
assert.match(html('~~gone~~'), /<del>gone<\/del>/);
{
  const a = dom('[site](https://example.com/x?a=1&b=2 "t")').querySelector('a')!;
  assert.strictEqual(a.getAttribute('href'), 'https://example.com/x?a=1&b=2');
  assert.strictEqual(a.getAttribute('rel'), 'noopener noreferrer');
  assert.strictEqual(a.getAttribute('target'), '_blank');
}
// streaming: unfinished markdown never throws and stays well formed
for (const part of ['**bol', '```js\nconst x', '| a | b |\n|---', '[lin', '- ', '> ', '`']) assert.doesNotThrow(() => html(part));
assert.match(html('```\nopen fence'), /<pre><code>open fence/);

// XSS: nothing active survives
const evil = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  '[x](javascript:alert(1))',
  '[x](JaVaScRiPt:alert(1))',
  '[x](data:text/html;base64,PHNjcmlwdD4=)',
  '[x](vbscript:msgbox(1))',
  '[x](file:///etc/passwd)',
  '[x](//evil.example/x)',
  '[x](/relative)',
  '![pic](https://tracker.example/p.png)',
  '![pic](javascript:alert(1))',
  '<iframe src="https://evil.example"></iframe>',
  '<svg onload=alert(1)><circle/></svg>',
  '<style>body{display:none}</style>',
  '<form action="https://evil.example"><input name=x><button>go</button></form>',
  '<div onclick="alert(1)" style="position:fixed">x</div>',
  '<a href="https://ok.example" onclick="alert(1)" style="x">y</a>',
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<details open ontoggle=alert(1)>',
  '<object data="https://evil.example"></object><embed src="x">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example"><link rel=stylesheet href=//evil.example>',
  '`<script>`\n\n```html\n<img src=x onerror=1>\n```',
  '[a](https://ok.example "x\\" onmouseover=\\"alert(1)")',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<<script>script>alert(1)<</script>/script>',
];
const bad = /<script|<img|<iframe|<svg|<style|<form|<input|<button|<object|<embed|<meta|<link|<math|\son[a-z]+\s*=|javascript:|vbscript:|data:text|file:|style\s*=/i;
for (const t of evil) {
  const out = html(t);
  const d = dom(t);
  for (const el of Array.from(d.body.querySelectorAll('*'))) {
    for (const at of Array.from(el.attributes)) assert.ok(['href', 'title', 'align', 'rel', 'target'].includes(at.name), `attribute ${at.name} in ${t} -> ${out}`);
    assert.ok(['P', 'BR', 'HR', 'STRONG', 'B', 'EM', 'I', 'DEL', 'S', 'CODE', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD'].includes(el.tagName), `tag ${el.tagName} in ${t}`);
  }
  for (const a of Array.from(d.querySelectorAll('a[href]'))) assert.match(a.getAttribute('href')!, /^https:\/\/ok\.example/, `link survived in ${t}`);
  // raw markup only ever appears as escaped text (&lt;...), never as real tags
  assert.ok(!/<(script|img|iframe|svg|style|form|input|button|object|embed|meta|link|math)\b/i.test(out), `tag in ${t} -> ${out}`);
  if (!/<code|<pre/.test(out)) assert.ok(!bad.test(out.replace(/&lt;[^]*?&gt;/g, '').replace(/="[^"]*"/g, '')), `unsafe in ${t} -> ${out}`);
}
// relative / protocol-relative / javascript links lose their href (plain text remains)
assert.strictEqual(dom('[x](javascript:alert(1))').querySelector('a[href]'), null);
assert.strictEqual(dom('[x](/relative)').querySelector('a[href]'), null);
assert.strictEqual(dom('[x](//evil.example/x)').querySelector('a[href]'), null);
// spec 080 FR-024: a mail link keeps its href (a click is classified in main); every other scheme of the hostile list loses it
assert.strictEqual(dom('[mail](mailto:a@example.com)').querySelector('a')!.getAttribute('href'), 'mailto:a@example.com');
for (const bad of ['ms-msdt:/id', 'search-ms:query=x', 'search:query=x', 'ms-officecmd:x', 'ms-settings:x', 'smb://host/share', 'file:///etc/hostname', 'vscode://file/x', 'slack://open', 'tel:+123', 'MS-MSDT:x', 'durbar-sim://pages/form']) {
  assert.strictEqual(dom(`[x](${bad})`).querySelector('a[href]'), null, `${bad} loses its href`);
}
{
  // the simulator's test pages only after allowSimLinks (never called in the app)
  const sim = create(marked, (createPurify.default ?? createPurify)(new JSDOM('<!doctype html><html><body></body></html>').window)) as { render(t: string): string; allowSimLinks(): void };
  const d2 = (t: string): Document => new JSDOM('<body>' + sim.render(t) + '</body>').window.document;
  assert.strictEqual(d2('[p](durbar-sim://pages/form)').querySelector('a[href]'), null, 'off by default');
  sim.allowSimLinks();
  assert.strictEqual(d2('[p](durbar-sim://pages/form)').querySelector('a')!.getAttribute('href'), 'durbar-sim://pages/form');
  assert.strictEqual(d2('[p](durbar-sim://other/form)').querySelector('a[href]'), null, 'only the pages host');
  assert.strictEqual(d2('[x](file:///etc/hostname)').querySelector('a[href]'), null);
}
assert.match(html('![pic](https://tracker.example/p.png)'), /\[image: pic\]/);
assert.ok(!/tracker\.example/.test(html('![pic](https://tracker.example/p.png)')), 'remote image url is not even kept');
// raw HTML is visible as text
assert.match(html('<b>hi</b>'), /&lt;b&gt;hi&lt;\/b&gt;/);

// size cap
const big = html('a'.repeat(md.MAX_CHARS + 50));
assert.match(big, /Message cut for display/);
assert.ok(big.length < md.MAX_CHARS + 500);
// no state leaks between calls (hooks added once)
assert.strictEqual(html('x'), html('x'));
{
  // count the hooks and sanitizer calls: a hook added on every render would pile up (and slow every chat message)
  let hooks = 0, sanitizes = 0;
  const spy = new Proxy(purify, { get(t, k) {
    const v = (t as any)[k]; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (k === 'addHook') return (...a: unknown[]) => { hooks++; return v.apply(t, a); };
    if (k === 'sanitize') return (...a: unknown[]) => { sanitizes++; return v.apply(t, a); };
    return typeof v === 'function' ? v.bind(t) : v;
  } });
  const md2 = create(marked, spy) as { render(t: string): string };
  const hooksAtStart = hooks;
  assert.strictEqual(hooksAtStart, 1, 'one hook is added when the renderer is created');
  for (let i = 0; i < 5; i++) md2.render('[x](https://a.example) ' + i);
  assert.strictEqual(sanitizes, 5, 'one sanitizer call per render');
  assert.strictEqual(hooks, hooksAtStart, 'rendering adds no hooks');
}
console.log('markdown tests passed');
