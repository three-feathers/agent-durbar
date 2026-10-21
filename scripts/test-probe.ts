/**
 * The office layout search's trial helpers (spec 001 FR-028): `svgHollow` keeps every outer <svg> tag and drops what is inside,
 * `styleSplit` separates style attributes, and the app and styles keep the conditions the in-place update relies on.
 * `npm run test:probe`. No credits spent. The layouts themselves are compared in the browser (spec 001 FR-028 verification).
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const R = path.join(__dirname, '..', '..', 'src', 'renderer');
const { svgHollow, styleSplit } = require(path.join(R, 'probe.js')) as {
  svgHollow: (h: string) => string;
  styleSplit: (h: string) => { bare: string; vals: string[] };
};

// no svg: unchanged
assert.strictEqual(svgHollow('<div class="a">x</div>'), '<div class="a">x</div>');
assert.strictEqual(svgHollow(''), '');
// the outer tag and its attributes stay, the drawing goes
assert.strictEqual(svgHollow('<b><svg class="scene" viewBox="0 0 10 10" data-sig="x"><g><rect/></g></svg></b>'), '<b><svg class="scene" viewBox="0 0 10 10" data-sig="x"></svg></b>');
// nested svg is part of the drawing
assert.strictEqual(svgHollow('<svg a="1"><svg b="2"><path/></svg><circle/></svg><i>t</i>'), '<svg a="1"></svg><i>t</i>');
// a self-closing svg, alone and nested
assert.strictEqual(svgHollow('<svg a="1"/><p>x</p>'), '<svg a="1"/><p>x</p>');
assert.strictEqual(svgHollow('<svg a="1"><svg b="2"/><g/></svg>|'), '<svg a="1"></svg>|');
// several in a row, text between them kept
assert.strictEqual(svgHollow('a<svg x="1"><g/></svg>b<svg y="2"><g/></svg>c'), 'a<svg x="1"></svg>b<svg y="2"></svg>c');
// unclosed: the rest is left as it is (never throws, never loops)
assert.strictEqual(svgHollow('<svg x="1"><g>'), '<svg x="1"><g>');
assert.strictEqual(svgHollow('<svg'), '<svg');
// linear time on a large input
{
  const big = '<div>' + '<span><svg class="s" viewBox="0 0 1 1"><g><path d="M0 0"/></g></svg></span>'.repeat(20000) + '</div>';
  const t = Date.now();
  const out = svgHollow(big);
  assert.ok(Date.now() - t < 2000, 'svgHollow is linear');
  assert.strictEqual((out.match(/<svg/g) || []).length, 20000);
  assert.ok(!out.includes('<path'));
}

// styleSplit: values in document order, the rest without them
{
  const a = styleSplit('<section class="room" style="--w:700;--min:200px" aria-label="x"><div class="units" style="--cols:3"></div></section>');
  assert.deepStrictEqual(a.vals, ['--w:700;--min:200px', '--cols:3']);
  assert.strictEqual(a.bare, '<section class="room" aria-label="x"><div class="units"></div></section>');
  const b = styleSplit('<section class="room" style="--w:480;--min:200px" aria-label="x"><div class="units" style="--cols:2"></div></section>');
  assert.strictEqual(a.bare, b.bare, 'two column counts differ only in style values');
  // data-style or text that only looks like a style attribute is not taken
  const c = styleSplit('<i data-style="a">style="b"</i>');
  assert.deepStrictEqual(c.vals, []);
}

// the app: every trial goes through probeSet (hollowed), and the probe's memory is cleared with it
const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8');
const cl = app.slice(app.indexOf('function chooseLayout('), app.indexOf('let layoutKey='));
assert.ok(cl.length > 100, 'chooseLayout found');
assert.ok(!/probe\.innerHTML=stageHTML\(/.test(cl), 'no trial parses the full drawings');
assert.ok((cl.match(/probeSet\(probe,stageHTML\(/g) || []).length >= 3, 'trials use probeSet');
assert.ok(/probe\.innerHTML='';\s*probePrev=null;/.test(cl), 'the probe and its memory are cleared together');
const ps = app.slice(app.indexOf('function probeSet('), app.indexOf('function chooseLayout('));
assert.ok(/^function probeSet\(probe,html\)\{\s*html=svgHollow\(html\);/.test(ps), 'probeSet hollows every trial first');
assert.ok(/probe\.innerHTML=html; probePrev=bare;/.test(ps), 'a full replace remembers what the probe holds');
// probe.js is loaded before app.js and packaged
const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
assert.ok(html.indexOf('src="probe.js"') > 0 && html.indexOf('src="probe.js"') < html.indexOf('src="app.js"'), 'probe.js before app.js');
assert.ok(fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'copy-assets.js'), 'utf8').includes("'probe.js'"), 'probe.js is copied');

// styles: --w, --min and --cols do not inherit, and only the element that carries them reads them
const css = fs.readFileSync(path.join(R, 'styles.css'), 'utf8').split(/\r?\n/);
for (const p of ['w', 'min', 'cols']) {
  assert.ok(css.some((l) => new RegExp(`@property --${p}\\{syntax:"\\*";inherits:false\\}`).test(l)), `--${p} is registered as not inherited`);
  const users = css.filter((l) => new RegExp(`var\\(--${p}[,)]`).test(l));
  for (const l of users) assert.ok(/^\.room\{|\.units\{/.test(l.trim()) || /^\.stage:not\(\[data-d="full"\]\) \.units\{/.test(l.trim()), `--${p} read only by .room / .units: ${l.slice(0, 80)}`);
}
for (const f of fs.readdirSync(R).filter((x) => /\.(css|js)$/.test(x) && x !== 'styles.css')) {
  const s = fs.readFileSync(path.join(R, f), 'utf8');
  assert.ok(!/var\(--(w|min|cols)[,)]/.test(s), `${f} must not read --w, --min or --cols (they do not inherit)`);
}
console.log('test-probe: ok');
