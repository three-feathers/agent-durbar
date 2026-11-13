/* Spec 052 (issue #1647): `danger-sites.js` counts every spelling of a danger confirm button in any renderer file. Each case writes a temp copy of a renderer dir. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findSites } = require('./danger-sites');
const real = path.join(__dirname, '..', 'src', 'renderer');
const base = findSites(real);
assert.strictEqual(base.length, 19, `the real renderer has 19 destructive dialog call sites, found ${base.length}`);
assert.ok(base.some((s) => s.file === 'screens.js') && base.some((s) => s.file === 'profileeditor.js') && base.some((s) => s.file === 'app.js'), 'sites from three files');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'danger-sites-'));
const mk = (files) => { for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f)); for (const [n, s] of Object.entries(files)) fs.writeFileSync(path.join(tmp, n), s); return findSites(tmp); };
try {
  const one = (cls) => `askDialog({buttons:[{label:'Cancel',value:null},{label:'Wipe',value:'ok',${cls}}]});`;
  for (const cls of ["cls:'primary danger'", "cls: 'primary danger'", 'cls:"primary danger"', "cls:'danger primary'", "cls:'primary  danger'", 'cls:`primary danger`']) {
    const s = mk({ 'other.js': one(cls) });
    assert.deepStrictEqual(s.map((x) => x.label), ['Wipe'], `a new file with ${cls} is counted`);
  }
  // a spelling the reader cannot parse fails with the intended text, not a silent miss
  assert.throws(() => mk({ 'other.js': "const b=document.createElement('button');b.className='btn primary danger';" }), /1 class string\(s\) with primary and danger but 0 call site\(s\) parsed/, 'className string');
  assert.throws(() => mk({ 'other.js': "buttons:[{label:'X',cls:'primary danger',value:'ok'}]" }), /parsed: a destructive dialog has a shape/, 'cls before value');
  // plain danger, primary alone, and a longer word are not sites
  assert.deepStrictEqual(mk({ 'a.js': "{label:'a',value:1,cls:'danger'},{label:'b',value:1,cls:'primary'},{label:'c',value:1,cls:'primary dangerous'}" }), [], 'one word, or another word, is not a site');
  console.log('test-danger-sites: ok');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
