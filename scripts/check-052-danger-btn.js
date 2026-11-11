/*
 * Spec 052 FR-053, FR-076 (issue #1565): the red confirm button of a destructive dialog (End all sessions, class `btn primary danger`) is legible and is
 * not the panel's own colour in every look whose ui style is not `clean`: the arcade world, and the Flat office under the built-in pixel theme (the
 * Photo office is the control). Simulator only (DURBAR_SIM=15, frozen), no AI credits; every wait is an until(). Run:
 * `npm run check:ui -- --only check-052-danger-btn`.
 *
 * Per look, at 1440x900 and 1280x800: the ⋯ menu is opened from the keyboard (focus the button, Down) and its End all sessions item is activated. The
 * button is measured as RENDERED (its own opacity and its parents' folded in over the dialog panel): at rest, focused and hovered (a real pointer move,
 * read once the colour has stopped changing) text is >= 4.5:1 on its own background and the background is not the panel's; hovered differs from rest;
 * a clone with the disabled attribute keeps the disabled look of every primary (a background that is not the rest red, dashed border), and its rendered
 * contrast is printed, not asserted (a disabled control is exempt and the dialog fades it).
 * DANGER_MUTANT=old deletes the themed danger rules (main's cascade); =unguard drops the `:not(:disabled...)` guard from the rest rule (a disabled
 * button turns red); =nohover deletes only the hover rule. Each must fail with its own label.
 * DANGER_REPORT=1 fails at the end on purpose, so the suite prints every measured line.
 * OUT=dir (optional) also saves 052-danger-btn-<look>-<size>.png
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();

const LOOKS = [
  ['arcade', { officeview: 'real', world: 'retro', worldflags: 'retro' }, null],
  ['flat+pixel theme', {}, 'retro'],
  ['photo', { officeview: 'real' }, null], // the control: ui is clean, the button was always red
];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const MEASURE = (sel) => `(()=>{const rgb=c=>{const m=c.match(/[\\d.]+/g).map(Number);return /^color\\(/.test(c)?m.slice(0,3).map(v=>Math.round(v*255)).concat(m.slice(3)):m;};
    const lum=c=>{const [r,g,b]=c.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*r+0.7152*g+0.0722*b;};
    const e=document.querySelector(${jsLiteral(sel)});if(!e)return null;const s=getComputedStyle(e),panel=rgb(getComputedStyle(document.querySelector('.dlg')).backgroundColor).slice(0,3);
    let op=1;for(let n=e;n&&n!==document.documentElement;n=n.parentElement)op*=+getComputedStyle(n).opacity;
    const mix=c=>c.slice(0,3).map((v,i)=>v*op+panel[i]*(1-op));
    const bg=mix(rgb(s.backgroundColor)),fg=mix(rgb(s.color)),a=lum(fg),b=lum(bg),r=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
    const t=x=>x.map(v=>Math.round(v)).join(',');
    return {css:s.backgroundColor,raw:t(rgb(s.backgroundColor)),bg:t(bg),fg:t(fg),panel:t(panel),op:Math.round(op*100)/100,border:s.borderTopStyle,ratio:Math.round(r*100)/100};})()`;
  const SEL = '.dlg .btn.primary.danger:not([data-probe])', PROBE = '.dlg .btn.primary.danger[data-probe]';
  const mutate = (kind) => js(`(()=>{let n=0;for(const s of document.styleSheets){let rules;try{rules=s.cssRules}catch(e){continue}
    for(let i=rules.length-1;i>=0;i--){const t=rules[i].selectorText||'';if(!/btn\\.primary\\.danger/.test(t)||!/data-ui/.test(t))continue;const hover=/:hover/.test(t);
      if(${jsLiteral(kind)}==='old'||(${jsLiteral(kind)}==='nohover'&&hover)){s.deleteRule(i);n++;}
      else if(${jsLiteral(kind)}==='unguard'&&!hover){const body=rules[i].style.cssText;s.deleteRule(i);s.insertRule(t.replace(/:not\\(:disabled[^)]*\\)/,'')+'{'+body+'}',i);n++;}}}return n})()`);
  for (const [look, query, theme] of LOOKS) {
    for (const [w, h] of [[1440, 900], [1280, 800]]) {
      const tag = `${look} ${w}x${h}`;
      await H.load({ w, h, query, settle: false, ready: query.officeview ? `!!document.querySelector('#stage .ro .ro-plate')` : undefined });
      if (theme) await js(`window.THEME.setTheme(${jsLiteral(theme)})`);
      await H.settle();
      if (process.env.DANGER_MUTANT) console.log(`[danger] mutant ${process.env.DANGER_MUTANT}: changed ${await mutate(process.env.DANGER_MUTANT)} themed danger rule(s)`);
      await js(`document.getElementById('topMoreBtn').focus()`); H.key('Down');
      assert.ok(await until(`!document.getElementById('topMoreMenu').hidden&&!document.getElementById('endAllBtn').hidden`, 5000), `${tag}: the ⋯ menu opened with its End all sessions item`);
      await js(`document.getElementById('endAllBtn').click()`);
      assert.ok(await until(`!!document.querySelector(${jsLiteral(SEL)})`, 8000), `${tag}: the End all sessions dialog opened`);
      assert.strictEqual(await js(`document.querySelector(${jsLiteral(SEL)}).textContent.trim()`), 'End all sessions', `${tag}: the red button is the confirm button`);
      await H.settle();
      const line = (state, m) => console.log(`[danger] ${tag} ${state}: text rgb(${m.fg}) on rgb(${m.bg}) = ${m.ratio}:1 rendered (opacity ${m.op}, ${m.border} border; ${m.css}), panel rgb(${m.panel})`);
      const check = (state, m) => {
        line(state, m);
        assert.ok(m.ratio >= 4.5, `${tag}: danger button ${state} contrast ${m.ratio}:1 is below 4.5:1`);
        assert.notStrictEqual(m.bg, m.panel, `${tag}: danger button ${state} is blank: its background rgb(${m.bg}) is the dialog panel's`);
      };
      const rest = await js(MEASURE(SEL));
      check('rest', rest);
      await js(`document.querySelector(${jsLiteral(SEL)}).focus()`);
      check('focus', await js(MEASURE(SEL)));
      const c = await js(`(()=>{const r=document.querySelector(${jsLiteral(SEL)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
      H.wc().sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y });
      assert.ok(await until(`document.querySelector(${jsLiteral(SEL)}).matches(':hover')`, 3000), `${tag}: the pointer is over the button`);
      let prev = '', hov = null; // the hover fade: two reads 120 ms apart agree and the colour is opaque
      for (let i = 0; i < 30; i++) { hov = await js(MEASURE(SEL)); if (hov.bg === prev && !/\/|rgba\(/.test(hov.css)) break; prev = hov.bg; await new Promise((r) => setTimeout(r, 120)); }
      check('hover', hov);
      assert.notStrictEqual(hov.bg, rest.bg, `${tag}: danger button hover looks the same as rest (rgb(${hov.bg})): no hover state`);
      await js(`(()=>{const b=document.querySelector(${jsLiteral(SEL)}),k=b.cloneNode(true);k.setAttribute('data-probe','1');k.id='';k.disabled=true;b.parentNode.appendChild(k)})()`);
      H.wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
      await new Promise((r) => setTimeout(r, 400));
      const dis = await js(MEASURE(PROBE));
      line('disabled', dis);
      assert.notStrictEqual(dis.raw, rest.raw, `${tag}: a disabled danger button looks enabled: still the rest red rgb(${rest.raw}) (disabled look lost)`);
      assert.strictEqual(dis.border, 'dashed', `${tag}: a disabled danger button has a ${dis.border} border, not the dashed disabled look`);
      await H.shot(path.join(OUT, `052-danger-btn-${look.replace(/\W+/g, '-')}-${w}x${h}.png`), { prep: 'none', settle: false, tag: 'danger' });
      await js(`document.querySelector(${jsLiteral(PROBE)}).remove()`);
      H.key('Escape');
      assert.ok(await until(`!document.querySelector('.dlg')`, 5000), `${tag}: Escape closes the dialog`);
    }
  }
  if (process.env.DANGER_REPORT) throw new Error('DANGER_REPORT: failing on purpose so the suite prints every measure');
  console.log('[danger] all checks passed');
};
