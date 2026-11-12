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
 * DANGER_MUTANT=pointer leaves the pointer over the button (the pointerOff call is skipped); =flash adds a hover animation that goes through black; =old deletes the themed danger rules (main's cascade); =unguard drops the `:not(:disabled...)` guard from the rest rule (a disabled
 * button turns red); =nohover deletes only the hover rule; =blackmix puts the old black mix back into every hover rule. Each must fail with its own label.
 * DANGER_REPORT=1 fails at the end on purpose, so the suite prints every measured line.
 * OUT=dir (optional) also saves 052-danger-btn-<look>-<size>.png
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral, CHECK_DARK } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();

const LOOKS = [
  ['arcade', { officeview: 'real', world: 'retro', worldflags: 'retro' }, null],
  ['flat+pixel theme', {}, 'retro'],
  ['photo', { officeview: 'real' }, null], // the control: ui is clean, the button was always red
  ['dark fixture', {}, CHECK_DARK], // a light fill with dark text: the hover must not darken it (4.14:1 with a black mix)
  ['cave', { officeview: 'real', world: 'cave', worldflags: 'cave' }, null],
];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  /* A colour as the page paints it: a canvas turns any serialisation (rgb(), color(srgb ...), and the oklab() a transition reports mid-way) into sRGB bytes. */
  const INSTALL_PX = `window.__px=(()=>{const cv=document.createElement('canvas');cv.width=cv.height=1;const g=cv.getContext('2d',{willReadFrequently:true});
    return c=>{g.clearRect(0,0,1,1);g.fillStyle='#000';g.fillStyle=c;g.fillRect(0,0,1,1);const d=g.getImageData(0,0,1,1).data;return [d[0],d[1],d[2],d[3]]}})();0`;
  const MEASURE = (sel) => `(()=>{const px=window.__px;
    const lum=c=>{const [r,g,b]=c.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*r+0.7152*g+0.0722*b;};
    const e=document.querySelector(${jsLiteral(sel)});if(!e)return null;const s=getComputedStyle(e),panel=px(getComputedStyle(document.querySelector('.dlg')).backgroundColor).slice(0,3);
    let op=1;for(let n=e;n&&n!==document.documentElement;n=n.parentElement)op*=+getComputedStyle(n).opacity;
    const B=px(s.backgroundColor),F=px(s.color);
    const mix=(c,o)=>c.slice(0,3).map((v,i)=>v*o+panel[i]*(1-o));
    const bg=mix(B,op*B[3]/255),fg=mix(F,op*F[3]/255),a=lum(fg),b=lum(bg),r=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
    const t=x=>x.map(v=>Math.round(v)).join(',');
    return {css:s.backgroundColor,raw:t(B.slice(0,3)),alpha:B[3],anim:e.getAnimations().length,bg:t(bg),fg:t(fg),panel:t(panel),op:Math.round(op*100)/100,border:s.borderTopStyle,ratio:Math.round(r*100)/100};})()`;
  const SEL = '.dlg .btn.primary.danger:not([data-probe])', PROBE = '.dlg .btn.primary.danger[data-probe]';
  const mutate = (kind) => js(`(()=>{let n=0;if(${jsLiteral(kind)}==='blackmix'){for(const s of document.styleSheets){let rules;try{rules=s.cssRules}catch(e){continue}for(const r of rules){if(/btn\\.primary\\.danger/.test(r.selectorText||'')&&/:hover/.test(r.selectorText)){r.style.setProperty('background','color-mix(in srgb,var(--red-ink) 86%,#000)');n++}}}return n}if(${jsLiteral(kind)}==='flash'){const st=document.createElement('style');st.textContent='@keyframes dflash{50%{background:#000}}.dlg .btn.primary.danger:hover{animation:dflash .3s}';document.head.appendChild(st);return 1}for(const s of document.styleSheets){let rules;try{rules=s.cssRules}catch(e){continue}
    for(let i=rules.length-1;i>=0;i--){const t=rules[i].selectorText||'';if(!/btn\\.primary\\.danger/.test(t)||!/data-ui/.test(t))continue;const hover=/:hover/.test(t);
      if(${jsLiteral(kind)}==='old'||(${jsLiteral(kind)}==='nohover'&&hover)){s.deleteRule(i);n++;}
      else if(${jsLiteral(kind)}==='unguard'&&!hover){const body=rules[i].style.cssText;s.deleteRule(i);s.insertRule(t.replace(/:not\\(:disabled[^)]*\\)/,'')+'{'+body+'}',i);n++;}}}return n})()`);
  for (const [look, query, theme] of LOOKS) {
    for (const [w, h] of [[1440, 900], [1280, 800]]) {
      const tag = `${look} ${w}x${h}`;
      await H.load({ w, h, query, settle: false, ready: query.officeview ? `!!document.querySelector('#stage .ro .ro-plate')` : undefined });
      if (theme) await js(`window.THEME.setTheme(${jsLiteral(theme)})`);
      await H.settle();
      await js(INSTALL_PX);
      if (process.env.DANGER_MUTANT) console.log(`[danger] mutant ${process.env.DANGER_MUTANT}: changed ${await mutate(process.env.DANGER_MUTANT)} themed danger rule(s)`);
      await js(`document.getElementById('topMoreBtn').focus()`); H.key('Down');
      assert.ok(await until(`!document.getElementById('topMoreMenu').hidden&&!document.getElementById('endAllBtn').hidden`, 5000), `${tag}: the ⋯ menu opened with its End all sessions item`);
      await js(`document.getElementById('endAllBtn').click()`);
      assert.ok(await until(`!!document.querySelector(${jsLiteral(SEL)})`, 8000), `${tag}: the End all sessions dialog opened`);
      assert.strictEqual(await js(`document.querySelector(${jsLiteral(SEL)}).textContent.trim()`), 'End all sessions', `${tag}: the red button is the confirm button`);
      // the pointer of the previous pass can still be over the new dialog's button: the rest is measured with it moved off (spec 008 FR-031: the shared helper)
      if (process.env.DANGER_MUTANT === 'pointer') {
        const q = await js(`(()=>{const r=document.querySelector(${jsLiteral(SEL)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
        H.wc().sendInputEvent({ type: 'mouseMove', x: q.x, y: q.y });
        await until(`document.querySelector(${jsLiteral(SEL)}).matches(':hover')`, 3000);
        console.log('[danger] mutant pointer: the pointerOff call is skipped, the pointer stays over the button');
      }
      const hoveredBefore = await H.pointerOff('.dlg', '.btn', { stay: process.env.DANGER_MUTANT === 'pointer' });
      assert.deepStrictEqual(hoveredBefore, [], `${tag}: the pointer is off the button before rest is measured: still hovered ${JSON.stringify(hoveredBefore)}`);
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
      // every frame of the hover fade is sampled (from before the pointer moves): rest -> hover must stay opaque and never go darker than both ends (a flash)
      await js(`(()=>{const px=window.__px;window.__fr=[];const b=document.querySelector(${jsLiteral(SEL)}),t0=performance.now();const f=()=>{window.__fr.push(px(getComputedStyle(b).backgroundColor));if(performance.now()-t0<900)requestAnimationFrame(f)};requestAnimationFrame(f)})()`);
      await new Promise((r) => setTimeout(r, 60));
      H.wc().sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y });
      assert.ok(await until(`document.querySelector(${jsLiteral(SEL)}).matches(':hover')`, 3000), `${tag}: the pointer is over the button`);
      assert.ok(await until(`document.querySelector(${jsLiteral(SEL)}).getAnimations().length===0&&window.__fr.length>20`, 5000), `${tag}: the hover transition ended (no running animation)`);
      const hov = await js(MEASURE(SEL));
      const fr = await js(`window.__fr`);
      const L = (x) => 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2], ends = [L(fr[0]), L(fr[fr.length - 1])], lo = Math.min(...ends) - 2;
      const flash = fr.filter((x) => x[3] < 255 || L(x) < lo);
      console.log(`[danger] ${tag} hover fade: ${fr.length} frames, ${new Set(fr.map((x) => x.join())).size} distinct, ${flash.length} transparent or darker than both ends`);
      assert.strictEqual(flash.length, 0, `${tag}: the hover fade flashes: ${flash.length} frame(s) transparent or darker than both rest and hover, first rgba(${flash[0]})`);
      check('hover', hov);
      assert.notStrictEqual(hov.bg, rest.bg, `${tag}: danger button hover looks the same as rest (rgb(${hov.bg})): no hover state`);
      await H.shot(path.join(OUT, `052-danger-btn-${look.replace(/\W+/g, '-')}-${w}x${h}-hover.png`), { prep: 'none', settle: false, tag: 'danger' });
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
