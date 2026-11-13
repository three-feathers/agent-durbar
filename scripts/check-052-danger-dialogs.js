/*
 * Spec 052 FR-053, FR-076 (issue #1647, follow-up of #1565/#1576): the red confirm button (`btn primary danger`) of EVERY destructive dialog, not only End
 * all sessions, reads at 4.5:1 or better at rest, focused and hovered, in the looks whose ui style is not `clean` (the arcade, the Flat office under the
 * pixel theme, the Cave world, and retro-ui USER themes: the fixture check-user, a dark one and a mid-tone-fill one) with Photo and the dark fixture as the
 * controls (ui `clean`). Simulator only (DURBAR_SIM=15, frozen), no AI credits; every wait is an until(). Run: `npm run check:ui -- --only check-052-danger-dialogs`.
 *
 * The call sites are READ from the source (`danger-sites.js`: every src/renderer/*.js, any spelling of the two class words): the driver asserts it found
 * (the count of the literal string equals the count it parsed, and the known number), so a new destructive dialog fails here until it is measured.
 * Per look and size each site's dialog is built with its own label: the app.js and profileeditor.js sites through the app's own builder
 * (`DurbarDialog(document)`, dialog.js), the screens.js sites through screens.js's own `dialog()` (exposed as `DurbarScreens.dialog`), so a markup change
 * in either shows here. The dialogs are not reached through their menus and screens: that is a [KNOWN GAP] stated in the spec delta.
 * The button is measured as RENDERED (the colour as the page paints it, opacity folded in over the dialog panel), after the dialog's entrance fade and
 * every transition ended: text >= 4.5:1 on its own background, a background that is not the panel's, hover differs from rest.
 * DANGER_MUTANT=old deletes the themed danger rules (main's cascade before #1576); =one blanks only the button of the "Revoke all" dialog (its label must be
 * the one named); =sites drops one call site from the list the driver parsed (the count assert fails); =screens moves the button row out of screens.js's dialog (fails at "the dialog opened" for the first screens.js site). Each fails with its own label.
 * DANGER_MUTANT=hover removes the --red-hover target theme.js wrote (issue #1700): the partial dark user theme's hover falls under 4.5:1 and the check fails with its label.
 * DANGER_REPORT=1 fails at the end on purpose, so the suite prints every measured line. OUT=dir (optional) saves 052-danger-dialogs-<look>-<size>.png
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { helpers, jsLiteral, CHECK_DARK } = require('./driver-helpers');
const { findSites } = require('./danger-sites');
const OUT = process.env.OUT || require('os').tmpdir();
const CHECK_USER = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'themes', 'check-user.json'), 'utf8'));
const user = (id, tokens) => ({ id, name: id, author: 'Agent Durbar tests', version: '1.0', ui: 'retro', tokens });

const LOOKS = [
  ['arcade', { officeview: 'real', world: 'retro', worldflags: 'retro' }, null],
  ['flat+pixel theme', {}, 'retro'],
  ['cave', { officeview: 'real', world: 'cave', worldflags: 'cave' }, null],
  ['check-user (retro ui)', {}, CHECK_USER],
  ['dark user theme (retro ui)', {}, { ...CHECK_DARK, id: 'dark-retro-user', ui: 'retro' }], // the dark fixture's complete token set, as a retro-ui theme
  ['mid-fill user theme (retro ui)', {}, user('mid-user', { '--bg': '#efe9dc', '--brand-bg': '#808080', '--brand-mark': '#000000' })],
  ['partial dark user theme (retro ui)', {}, user('partial-dark', { '--bg': '#14121f', '--surface': '#1e1b2e', '--ink': '#f0eaff' })], // issue #1700: --ink set, no --raised/--card: theme.js repairs --ink to a mid grey; the hover would read 4.33:1 without --red-hover
  ['photo', { officeview: 'real' }, null], // control: ui is clean
  ['dark fixture', {}, CHECK_DARK], // control: ui is clean
];
const KNOWN_SITES = 19; // End all sessions and the 18 others of issue #1647

/* the call sites, read from the source (danger-sites.js: every src/renderer/*.js, any spelling; test-danger-sites.js proves the reader) */
function sites() {
  const out = findSites(path.join(__dirname, '..', 'src', 'renderer'));
  if (process.env.DANGER_MUTANT === 'sites') out.pop();
  assert.strictEqual(out.length, KNOWN_SITES, `${out.length} destructive-dialog call sites, ${KNOWN_SITES} known: measure the new one (add it to the spec delta) and update KNOWN_SITES`);
  return out;
}

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const SITES = sites();
  const INSTALL_PX = `window.__px=(()=>{const cv=document.createElement('canvas');cv.width=cv.height=1;const g=cv.getContext('2d',{willReadFrequently:true});
    return c=>{g.clearRect(0,0,1,1);g.fillStyle='#000';g.fillStyle=c;g.fillRect(0,0,1,1);const d=g.getImageData(0,0,1,1).data;return [d[0],d[1],d[2],d[3]]}})();0`;
  const SEL = '.dlg .btn.primary.danger';
  const MEASURE = `(()=>{const px=window.__px;
    const lum=c=>{const [r,g,b]=c.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*r+0.7152*g+0.0722*b;};
    const e=document.querySelector(${jsLiteral(SEL)});if(!e)return null;const s=getComputedStyle(e),panel=px(getComputedStyle(document.querySelector('.dlg')).backgroundColor).slice(0,3);
    let op=1;for(let n=e;n&&n!==document.documentElement;n=n.parentElement)op*=+getComputedStyle(n).opacity;
    const B=px(s.backgroundColor),F=px(s.color);
    const mix=(c,o)=>c.slice(0,3).map((v,i)=>v*o+panel[i]*(1-o));
    const bg=mix(B,op*B[3]/255),fg=mix(F,op*F[3]/255),a=lum(fg),b=lum(bg),r=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
    const t=x=>x.map(v=>Math.round(v)).join(',');
    return {css:s.backgroundColor,bg:t(bg),fg:t(fg),panel:t(panel),op:Math.round(op*100)/100,ratio:Math.round(r*100)/100};})()`;
  /* both builders are the app's own: dialog.js's askDialog for app.js and profileeditor.js, and screens.js's `dialog()` (exposed as DurbarScreens.dialog for the folder-setup list) for screens.js */
  const OPEN = (site) => {
    const btns = [{ label: 'Cancel', value: null }, { label: site.label, value: 'ok', cls: 'primary danger' }];
    if (!site.screens) return `(()=>{window.DurbarDialog(document)({title:'Check',body:'A destructive confirmation.',buttons:${jsLiteral(btns)}});return 1})()`;
    /* DANGER_MUTANT=screens: screens.js's markup changed, the button row left the dialog; the driver must fail at "the dialog opened" for this label */
    return `(()=>{window.DurbarScreens.dialog({title:'Check',html:'<p class="dsub">A destructive confirmation.</p>',buttons:${jsLiteral(btns)}});
      ${process.env.DANGER_MUTANT === 'screens' ? `const o=document.getElementById('scrDlg');o.appendChild(o.querySelector('.dbtn'));` : ''}return 1})()`;
  };
  const mutate = (kind) => js(`(()=>{let n=0;for(const s of document.styleSheets){let rules;try{rules=s.cssRules}catch(e){continue}
    for(let i=rules.length-1;i>=0;i--){const t=rules[i].selectorText||'';if(/btn\\.primary\\.danger/.test(t)&&/data-ui/.test(t)&&${jsLiteral(kind)}==='old'){s.deleteRule(i);n++}}}return n})()`);
  const DONE = `(()=>{const d=document.querySelector('.dlg'),o=document.querySelector('.dlg-ov'),b=document.querySelector(${jsLiteral(SEL)});return !!b&&d.getAnimations({subtree:true}).length+(o?o.getAnimations().length:0)+b.getAnimations().length===0&&+getComputedStyle(d).opacity===1&&+getComputedStyle(b).opacity===1&&(!o||+getComputedStyle(o).opacity===1)})()`;
  const report = [], summary = [];
  try {
  for (const [look, query, theme] of LOOKS) {
    for (const [w, h] of [[1440, 900], [1280, 800]]) {
      await H.load({ w, h, query, settle: false, ready: query.officeview ? `!!document.querySelector('#stage .ro .ro-plate')` : undefined });
      if (theme) await js(`window.THEME.setTheme(${jsLiteral(theme)})`);
      await H.settle();
      await js(INSTALL_PX);
      if (process.env.DANGER_MUTANT === 'hover') {
        const was = await js("(()=>{const e=document.documentElement,v=e.style.getPropertyValue('--red-hover');e.style.removeProperty('--red-hover');return v})()");
        console.log('[danger-dlgs] mutant hover: --red-hover was ' + JSON.stringify(was));
      }
      if (process.env.DANGER_MUTANT === 'old') console.log(`[danger-dlgs] mutant old: changed ${await mutate('old')} themed danger rule(s)`);
      let shot = false;
      for (const site of SITES) {
        const tag = `${look} ${w}x${h} ${site.file} "${site.label}"`;
        await js(OPEN(site));
        assert.ok(await until(`!!document.querySelector(${jsLiteral(SEL)})`, 8000), `${tag}: the dialog opened`);
        assert.strictEqual(await js(`document.querySelector(${jsLiteral(SEL)}).textContent.trim()`), site.label, `${tag}: the red button is the confirm button`);
        if (process.env.DANGER_MUTANT === 'one' && site.label === 'Revoke all') await js(`(()=>{const st=document.createElement('style');st.id='mut';st.textContent='.dlg .btn.primary.danger{background:var(--surface)!important;color:var(--surface)!important}';document.head.appendChild(st)})()`);
        const hoveredBefore = await H.pointerOff('.dlg', '.btn', {});
        assert.deepStrictEqual(hoveredBefore, [], `${tag}: the pointer is off the button before rest is measured: still hovered ${JSON.stringify(hoveredBefore)}`);
        assert.ok(await until(DONE, 4000), `${tag}: the dialog's entrance fade and the button's transition ended before rest is measured`);
        const check = (state, m) => {
          report.push(`[danger-dlgs] ${tag} ${state}: text rgb(${m.fg}) on rgb(${m.bg}) = ${m.ratio}:1 (${m.css}), panel rgb(${m.panel})`);
          assert.ok(m.ratio >= 4.5, `${tag}: danger button ${state} contrast ${m.ratio}:1 is below 4.5:1`);
          assert.notStrictEqual(m.bg, m.panel, `${tag}: danger button ${state} is blank: its background rgb(${m.bg}) is the dialog panel's`);
        };
        const rest = await js(MEASURE);
        check('rest', rest);
        await js(`document.querySelector(${jsLiteral(SEL)}).focus()`);
        check('focus', await js(MEASURE));
        const c = await js(`(()=>{const r=document.querySelector(${jsLiteral(SEL)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
        H.wc().sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y });
        assert.ok(await until(`document.querySelector(${jsLiteral(SEL)}).matches(':hover')`, 3000), `${tag}: the pointer is over the button`);
        assert.ok(await until(`document.querySelector(${jsLiteral(SEL)}).getAnimations().length===0`, 5000), `${tag}: the hover transition ended`);
        await new Promise((r) => setTimeout(r, 60));
        const hov = await js(MEASURE);
        check('hover', hov);
        assert.notStrictEqual(hov.bg, rest.bg, `${tag}: danger button hover looks the same as rest (rgb(${hov.bg})): no hover state`);
        if (!shot && site.label === 'Revoke all') { shot = true; await H.shot(path.join(OUT, `052-danger-dialogs-${look.replace(/\W+/g, '-')}-${w}x${h}.png`), { prep: 'none', settle: false, tag: 'danger-dlgs' }); }
        H.wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
        H.key('Escape');
        if (!(await until(`!document.querySelector('.dlg')`, 3000))) await js(`document.querySelectorAll('.dlg-ov').forEach(n=>n.remove());0`);
        await js(`document.getElementById('mut')&&document.getElementById('mut').remove();0`);
      }
      const mine = report.slice(-SITES.length * 3).map((l) => +l.match(/= ([\d.]+):1/)[1]);
      summary.push(`${look} ${w}x${h}: lowest ${Math.min(...mine)}:1, highest ${Math.max(...mine)}:1`);
      console.log(`[danger-dlgs] ${look} ${w}x${h}: ${SITES.length} dialogs x rest, focus, hover all >= 4.5:1 (lowest ${Math.min(...mine)}:1, highest ${Math.max(...mine)}:1)`);
    }
  }
  } catch (e) { console.log(report.slice(-4).join('\n')); throw e; }
  const worst = report.map((l) => ({ l, r: +l.match(/= ([\d.]+):1/)[1] })).sort((a, b) => a.r - b.r)[0];
  console.log(`[danger-dlgs] ${report.length} reads; lowest: ${worst.l}`);
  fs.writeFileSync(path.join(OUT, '052-danger-dialogs-report.txt'), summary.join('\n') + '\n\n' + report.join('\n') + '\n');
  if (process.env.DANGER_REPORT) { console.log(report.join('\n')); throw new Error('DANGER_REPORT: failing on purpose so the suite prints every measure'); }
  console.log('[danger-dlgs] all checks passed');
};
