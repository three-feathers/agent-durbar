/*
 * Spec 052 FR-053, FR-076 (issue #1570, same cascade as #1565): in every look whose ui style is not `clean` (the arcade, Flat under the pixel theme, the Cave)
 * a button keeps the meaning its class gives it. Three buttons, each measured as RENDERED (opacity folded in over the dialog panel) at rest, focused and
 * hovered, at 1440x900 and 1280x800, with Photo as the control (ui `clean`):
 *   WARN  `.btn.primary.warn` (Allow all, Turn on, Trust and enable): its fill is the warn tint, not the plain button's surface; text >= 4.5:1; hover differs.
 *   DANGER HOVER  the plain `.btn.danger` (Delete the file): at rest the plain button, on hover the soft red fill (not the surface); text >= 4.5:1 on it.
 *   SITES  "Remove theme" (screens.js) and "End N sessions and update" (harnesses.js) are `primary danger` confirms (read from the source; the first is also
 *   opened through screens.js's own dialog() and measured as the red button). Text of every button >= 10.5px.
 * Simulator only (DURBAR_SIM=15, frozen), no AI credits. Run: `npm run check:ui -- --only check-052-warn-danger-btn`.
 * WARN_MUTANT=old deletes the three themed rules (main's cascade); =warn / =dangerhover delete one; =sites reads the two call sites with their old plain class.
 * Each fails with its own label. WARN_REPORT=1 fails at the end on purpose so the suite prints every measure. OUT=dir (optional) saves pictures.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();
const LOOKS = [
  ['arcade', { officeview: 'real', world: 'retro', worldflags: 'retro' }, null],
  ['flat+pixel theme', {}, 'retro'],
  ['cave', { officeview: 'real', world: 'cave', worldflags: 'cave' }, null],
  ['photo', { officeview: 'real' }, null], // control: ui is clean, the styles.css rules always applied
];
const M = process.env.WARN_MUTANT || '';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  // the two call sites, from the source
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', f), 'utf8').replace(M === 'sites' ? /primary danger/g : /$^/g, 'danger');
  assert.ok(/label:\s*'Remove theme',\s*value:\s*'rm',\s*cls:\s*'primary danger'/.test(src('screens.js')), 'Remove theme (screens.js) is not a primary danger confirm: it is a plain red button, not the red confirm of the other destructive dialogs');
  assert.ok(/label:\s*`End \$\{n\} session\$\{n === 1 \? '' : 's'\} and update`,\s*cls:\s*'primary danger'/.test(src('harnesses.js')), 'End N sessions and update (harnesses.js) is not a primary danger confirm: it is a plain red button, not the red confirm of the other destructive dialogs');
  const INSTALL_PX = `window.__px=(()=>{const cv=document.createElement('canvas');cv.width=cv.height=1;const g=cv.getContext('2d',{willReadFrequently:true});
    return c=>{g.clearRect(0,0,1,1);g.fillStyle='#000';g.fillStyle=c;g.fillRect(0,0,1,1);const d=g.getImageData(0,0,1,1).data;return [d[0],d[1],d[2],d[3]]}})();0`;
  const MEASURE = (sel) => `(()=>{const px=window.__px;
    const lum=c=>{const [r,g,b]=c.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*r+0.7152*g+0.0722*b;};
    const e=document.querySelector(${jsLiteral(sel)});if(!e)return null;const s=getComputedStyle(e),panel=px(getComputedStyle(document.querySelector('.dlg')).backgroundColor).slice(0,3);
    let op=1;for(let n=e;n&&n!==document.documentElement;n=n.parentElement)op*=+getComputedStyle(n).opacity;
    const B=px(s.backgroundColor),F=px(s.color),mix=(c,o)=>c.slice(0,3).map((v,i)=>v*o+panel[i]*(1-o));
    const bg=mix(B,op*B[3]/255),fg=mix(F,op*F[3]/255),a=lum(fg),b=lum(bg),r=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05),t=x=>x.map(v=>Math.round(v)).join(',');
    return {css:s.backgroundColor,bg:t(bg),fg:t(fg),panel:t(panel),font:parseFloat(s.fontSize),ratio:Math.round(r*100)/100};})()`;
  const mutate = (kind) => js(`(()=>{let n=0;for(const s of document.styleSheets){let rules;try{rules=s.cssRules}catch(e){continue}
    for(let i=rules.length-1;i>=0;i--){const t=rules[i].selectorText||'';if(!/data-ui/.test(t))continue;
      const warn=/btn\\.primary\\.warn/.test(t),dh=/btn\\.danger:not\\(\\.primary/.test(t);
      if((${jsLiteral(kind)}==='old'&&(warn||dh))||(${jsLiteral(kind)}==='warn'&&warn)||(${jsLiteral(kind)}==='dangerhover'&&dh)){s.deleteRule(i);n++}}}return n})()`);
  const DONE = (sel) => `(()=>{const d=document.querySelector('.dlg'),o=document.querySelector('.dlg-ov'),b=document.querySelector(${jsLiteral(sel)});return !!b&&d.getAnimations({subtree:true}).length+(o?o.getAnimations().length:0)+b.getAnimations().length===0&&+getComputedStyle(d).opacity===1&&+getComputedStyle(b).opacity===1})()`;
  const report = [];
  for (const [look, query, theme] of LOOKS) {
    for (const [w, h] of [[1440, 900], [1280, 800]]) {
      await H.load({ w, h, query, settle: false, ready: query.officeview ? `!!document.querySelector('#stage .ro .ro-plate')` : undefined });
      if (theme) await js(`window.THEME.setTheme(${jsLiteral(theme)})`);
      await H.settle();
      await js(INSTALL_PX);
      if (M && M !== 'sites') console.log(`[warn-btn] mutant ${M}: changed ${await mutate(M)} themed rule(s)`);
      // one dialog per case: [what, button class, label, state check]
      const CASES = [
        ['warn', 'primary warn', 'Allow all'],
        ['danger', 'danger', 'Delete the file'],
        ['remove-theme', 'primary danger', 'Remove theme'],
      ];
      for (const [kind, cls, label] of CASES) {
        const tag = `${look} ${w}x${h} ${kind} "${label}"`;
        const SEL = `.dlg .btn[data-probe="${kind}"]`;
        const btns = [{ label: 'Cancel', value: null }, { label, value: 'ok', cls }];
        if (kind === 'remove-theme') await js(`(()=>{window.DurbarScreens.dialog({title:'Check',html:'<p class="dsub">A destructive confirmation.</p>',buttons:${jsLiteral(btns)}});return 1})()`);
        else await js(`(()=>{window.DurbarDialog(document)({title:'Check',body:'A confirmation.',buttons:${jsLiteral(btns)}});return 1})()`);
        assert.ok(await until(`!!document.querySelector('.dlg')&&[...document.querySelectorAll('.dlg .btn')].some(b=>b.textContent.trim()===${jsLiteral(label)})`, 8000), `${tag}: the dialog opened`);
        await js(`[...document.querySelectorAll('.dlg .btn')].find(b=>b.textContent.trim()===${jsLiteral(label)}).setAttribute('data-probe',${jsLiteral(kind)});0`);
        const cancel = await js(`(()=>{const c=[...document.querySelectorAll('.dlg .btn')].find(b=>b.textContent.trim()==='Cancel');c.setAttribute('data-probe','cancel');return 1})()`);
        assert.deepStrictEqual(await H.pointerOff('.dlg', '.btn', {}), [], `${tag}: the pointer is off the buttons before rest is measured`);
        assert.ok(await until(DONE(SEL), 4000), `${tag}: the entrance fade and every transition ended`);
        const line = (state, m) => report.push(`[warn-btn] ${tag} ${state}: text rgb(${m.fg}) on rgb(${m.bg}) = ${m.ratio}:1 (${m.css}, ${m.font}px), panel rgb(${m.panel})`);
        const rest = await js(MEASURE(SEL)), plain = await js(MEASURE('.dlg .btn[data-probe="cancel"]'));
        line('rest', rest);
        assert.ok(rest.font >= 10.5, `${tag}: text is ${rest.font}px, under 10.5px`);
        assert.ok(rest.ratio >= 4.5, `${tag}: ${kind} button rest contrast ${rest.ratio}:1 is below 4.5:1`);
        if (kind === 'warn') assert.notStrictEqual(rest.bg, plain.bg, `${tag}: the warn button lost its warn fill: its background rgb(${rest.bg}) is the plain button's (a warn button reads as a plain one)`);
        if (kind === 'remove-theme') assert.notStrictEqual(rest.bg, plain.bg, `${tag}: the Remove theme confirm is not the red confirm: its background rgb(${rest.bg}) is the plain button's`);
        await js(`document.querySelector(${jsLiteral(SEL)}).focus()`);
        const foc = await js(MEASURE(SEL)); line('focus', foc);
        assert.ok(foc.ratio >= 4.5, `${tag}: ${kind} button focus contrast ${foc.ratio}:1 is below 4.5:1`);
        const c = await js(`(()=>{const r=document.querySelector(${jsLiteral(SEL)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
        H.wc().sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y });
        assert.ok(await until(`document.querySelector(${jsLiteral(SEL)}).matches(':hover')`, 3000), `${tag}: the pointer is over the button`);
        assert.ok(await until(`document.querySelector(${jsLiteral(SEL)}).getAnimations().length===0`, 5000), `${tag}: the hover transition ended`);
        await new Promise((r) => setTimeout(r, 60));
        const hov = await js(MEASURE(SEL)); line('hover', hov);
        assert.ok(hov.ratio >= 4.5, `${tag}: ${kind} button hover contrast ${hov.ratio}:1 is below 4.5:1`);
        assert.notStrictEqual(hov.bg, rest.bg, `${tag}: the ${kind} button hover looks the same as rest (rgb(${hov.bg})): no hover state`);
        if (kind === 'danger') assert.notStrictEqual(hov.bg, hov.panel, `${tag}: the danger button on hover is the panel's colour rgb(${hov.panel}): its soft red hover fill was lost`);
        if (kind === 'warn' && w === 1440) await H.shot(path.join(OUT, `052-warn-btn-${look.replace(/\W+/g, '-')}-${w}x${h}-hover.png`), { prep: 'none', settle: false, tag: 'warn-btn' });
        if (w === 1280 || kind !== 'warn') await H.shot(path.join(OUT, `052-warn-btn-${look.replace(/\W+/g, '-')}-${kind}-${w}x${h}.png`), { prep: 'none', settle: false, tag: 'warn-btn' });
        H.wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
        H.key('Escape');
        if (!(await until(`!document.querySelector('.dlg')`, 3000))) await js(`document.querySelectorAll('.dlg-ov,#scrDlg').forEach(n=>n.remove());0`);
      }
    }
  }
  console.log(report.filter((l) => /rest/.test(l)).join('\n'));
  if (process.env.WARN_REPORT) { console.log(report.join('\n')); throw new Error('WARN_REPORT: failing on purpose so the suite prints every measure'); }
  console.log('[warn-btn] all checks passed');
};
