/*
 * Spec 052 FR-053 (issue #1614): the themed primary button (`.btn.primary`, not warn or danger) reads at 4.5:1 or better in rest, hover and active in every
 * look that themes it (every ui style but `clean`): the retro-UI user theme fixture (scripts/fixtures/themes/check-user.json), the Flat office under the
 * built-in pixel theme, the arcade and Cave worlds; Photo and the dark fixture (ui clean) are the controls. Simulator only (DURBAR_SIM=15, frozen), no AI
 * credits. Run: `npm run check:ui -- --only check-052-primary-btn`.
 *
 * Per look, at 1440x900 and 1280x800: the End all sessions dialog is opened from the keyboard-opened ⋯ menu, its confirm button is cloned without `danger`
 * (a real `.dlg .btn.primary`, the one rule every dialog, the panel, settings and the answer bar share) and measured as RENDERED (the colour as the page
 * paints it, read once the transition has ended): text on its own background at rest, hovered (a real pointer move) and active (a real mouse down).
 * PRIMARY_MUTANT=black puts the old black mix back into the themed primary hover rule, PRIMARY_MUTANT=toward the first version's always-toward-the-text mix (--brand-hover ignored) (the floor in theme.js and themegen.ts has its own unit tests: scripts/test-themegen.ts, test-userthemes.ts). PRIMARY_REPORT=1 fails at the end on purpose so the suite prints every measured line.
 * OUT=dir (optional) saves 052-primary-btn-<look>-<size>-<state>.png
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { helpers, jsLiteral, CHECK_DARK } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();
const CHECK_USER = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'themes', 'check-user.json'), 'utf8'));

/* review of PR #1618: a retro-ui user theme with a dark or mid-tone fill; toward the text would drop the hovered text under 4.5:1 (#2a6a9a with white text 4.31, #8a5a28 4.35, #808080 with black text 4.12), the repair hovers away from it */
const fill = (id, bg, mk) => ({ id, name: id, author: 'Agent Durbar tests', version: '1.0', ui: 'retro', tokens: { '--bg': '#efe9dc', '--brand-bg': bg, '--brand-mark': mk } });
const LOOKS = [
  ['check-user (retro ui)', {}, CHECK_USER],
  ['flat+pixel theme', {}, 'retro'],
  ['arcade', { officeview: 'real', world: 'retro', worldflags: 'retro' }, null],
  ['cave', { officeview: 'real', world: 'cave', worldflags: 'cave' }, null],
  ['photo', { officeview: 'real' }, null], // control: ui is clean
  ['dark fixture', {}, CHECK_DARK], // control: ui is clean
  ['dark-fill blue 2a6a9a white', {}, fill('fill-blue', '#2a6a9a', '#ffffff')],
  ['dark-fill brown 8a5a28 white', {}, fill('fill-brown', '#8a5a28', '#ffffff')],
  ['mid-fill grey 808080 black', {}, fill('fill-grey', '#808080', '#000000')],
];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
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
    return {css:s.backgroundColor,anim:e.getAnimations().length,bg:t(bg),fg:t(fg),op:Math.round(op*100)/100,ratio:Math.round(r*100)/100};})()`;
  const SEL = '.dlg .btn.primary[data-probe]';
  /* PRIMARY_MUTANT=black or toward: the old black mix, or the toward-text mix, back in every themed primary hover rule (the rule's text names :hover and .btn.primary under data-ui) */
  const mutate = () => js(`(()=>{let n=0;for(const s of document.styleSheets){let rules;try{rules=s.cssRules}catch(e){continue}for(const r of rules){const t=r.selectorText||'';
    if(/data-ui/.test(t)&&/\\.btn\\.primary/.test(t)&&/:hover/.test(t)&&!/\\.btn\\.primary\\.danger/.test(t)){r.style.setProperty('background','color-mix(in srgb,var(--brand-bg) 86%,'+(${jsLiteral(process.env.PRIMARY_MUTANT === 'toward' ? 'var(--brand-mark)' : '#000')})+')');n++}}}return n})()`);
  for (const [look, query, theme] of LOOKS) {
    for (const [w, h] of [[1440, 900], [1280, 800]]) {
      const tag = `${look} ${w}x${h}`;
      await H.load({ w, h, query, settle: false, ready: query.officeview ? `!!document.querySelector('#stage .ro .ro-plate')` : undefined });
      if (theme) await js(`window.THEME.setTheme(${jsLiteral(theme)})`);
      await H.settle();
      await js(INSTALL_PX);
      if (process.env.PRIMARY_MUTANT) console.log(`[primary] mutant ${process.env.PRIMARY_MUTANT}: changed ${await mutate()} rule(s)`);
      await js(`document.getElementById('topMoreBtn').focus()`); H.key('Down');
      assert.ok(await until(`!document.getElementById('topMoreMenu').hidden&&!document.getElementById('endAllBtn').hidden`, 5000), `${tag}: the ⋯ menu opened`);
      await js(`document.getElementById('endAllBtn').click()`);
      assert.ok(await until(`!!document.querySelector('.dlg .btn.primary.danger')`, 8000), `${tag}: the dialog opened`);
      await H.settle();
      await js(`(()=>{const b=document.querySelector('.dlg .btn.primary.danger'),k=b.cloneNode(true);k.classList.remove('danger');k.setAttribute('data-probe','1');k.id='';k.textContent='Primary';b.parentNode.insertBefore(k,b)})()`);
      H.wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 }); // the pointer of the last run may still be over the new button
      assert.ok(await until(`!document.querySelector(${jsLiteral(SEL)}).matches(':hover')`, 3000), `${tag}: the pointer is off the button at rest`);
      const ui = await js(`document.documentElement.getAttribute('data-ui')||'clean'`);
      const line = (state, m) => { const t = `[primary] ${tag} (ui ${ui}) ${state}: text rgb(${m.fg}) on rgb(${m.bg}) = ${m.ratio}:1 (${m.css})`; console.log(t); if (process.env.PRIMARY_REPORT) fs.appendFileSync(path.join(OUT, 'primary-report.txt'), t + '\n'); };
      const check = (state, m) => { line(state, m); if (!process.env.PRIMARY_REPORT) assert.ok(m.ratio >= 4.5, `${tag}: primary button ${state} contrast ${m.ratio}:1 is below 4.5:1`); };
      const still = async () => assert.ok(await until(`document.querySelector(${jsLiteral(SEL)}).getAnimations().length===0`, 5000), `${tag}: the transition ended`);
      await still();
      const rest = await js(MEASURE(SEL));
      check('rest', rest);
      const c = await js(`(()=>{const r=document.querySelector(${jsLiteral(SEL)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
      H.wc().sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y });
      assert.ok(await until(`document.querySelector(${jsLiteral(SEL)}).matches(':hover')`, 3000), `${tag}: the pointer is over the button`);
      await still();
      check('hover', await js(MEASURE(SEL)));
      await H.shot(path.join(OUT, `052-primary-btn-${look.replace(/\W+/g, '-')}-${w}x${h}-hover.png`), { prep: 'none', settle: false, tag: 'primary' });
      H.wc().sendInputEvent({ type: 'mouseDown', x: c.x, y: c.y, button: 'left', clickCount: 1 });
      assert.ok(await until(`document.querySelector(${jsLiteral(SEL)}).matches(':active')`, 3000), `${tag}: the button is pressed (:active)`);
      await still();
      check('active', await js(MEASURE(SEL)));
      H.wc().sendInputEvent({ type: 'mouseUp', x: c.x, y: c.y, button: 'left', clickCount: 1 });
      await H.shot(path.join(OUT, `052-primary-btn-${look.replace(/\W+/g, '-')}-${w}x${h}.png`), { prep: 'none', settle: false, tag: 'primary' });
      await js(`document.querySelector(${jsLiteral(SEL)}).remove()`);
      H.key('Escape');
      assert.ok(await until(`!document.querySelector('.dlg')`, 5000), `${tag}: Escape closes the dialog`);
    }
  }
  if (process.env.PRIMARY_REPORT) throw new Error('PRIMARY_REPORT: failing on purpose so the suite prints every measure');
  console.log('[primary] all checks passed');
};
