/*
 * Spec 102 (issue #1565): the red confirm button of a destructive dialog (End all sessions, class `btn primary danger`) is legible and is not the
 * panel's own colour in every look whose ui style is not `clean`: the arcade world, and the flat office under the built-in pixel theme.
 * Simulator only (DURBAR_SIM=15, frozen), no AI credits; every wait is an until(). Run: `npm run check:ui -- --only check-102-danger-btn`.
 *
 * Per look, at 1440x900 and 1280x800: the dialog "End all sessions?" is opened through the real ⋯ menu button; the button's text against its
 * own background is >= 4.5:1 at rest, hovered (a real mouse move), focused and disabled (a clone with the disabled attribute), and its
 * background is not the dialog panel's background (not blank). The measure is printed.
 * DANGER_MUTANT=1 deletes the rule that fixes it from the loaded stylesheet (what main had before), so the checks must fail with their own label.
 * OUT=dir (optional) also saves 102-danger-btn-<look>-<size>.png
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
  const MEASURE = (sel) => `(()=>{const rgb=c=>{const m=c.match(/[\\d.]+/g).map(Number);return /^color\\(/.test(c)?m.slice(0,3).map(v=>Math.round(v*255)).concat(m.slice(3)):m;};const lum=c=>{const [r,g,b]=c.slice(0,3).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*r+0.7152*g+0.0722*b;};
    const e=document.querySelector(${jsLiteral(sel)});if(!e)return null;const s=getComputedStyle(e),d=getComputedStyle(document.querySelector('.dlg'));
    const bg=rgb(s.backgroundColor),fg=rgb(s.color),a=lum(fg),b=lum(bg),r=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
    return {bg:bg.slice(0,3).join(','),alpha:bg.length>3?bg[3]:1,fg:fg.slice(0,3).join(','),panel:rgb(d.backgroundColor).slice(0,3).join(','),ratio:Math.round(r*100)/100};})()`;
  const SEL = '.dlg .btn.primary.danger:not([data-probe])';
  for (const [look, query, theme] of LOOKS) {
    for (const [w, h] of [[1440, 900], [1280, 800]]) {
      const tag = `${look} ${w}x${h}`;
      await H.load({ w, h, query, settle: false, ready: query.officeview ? `!!document.querySelector('#stage .ro .ro-plate')` : undefined });
      if (theme) await js(`window.THEME.setTheme(${jsLiteral(theme)})`);
      await H.settle();
      if (process.env.DANGER_MUTANT) {
        const n = await js(`(()=>{let n=0;for(const s of document.styleSheets){let rules;try{rules=s.cssRules}catch(e){continue}for(let i=rules.length-1;i>=0;i--){if(/btn\\.primary\\.danger/.test(rules[i].selectorText||'')&&/data-ui/.test(rules[i].selectorText)){s.deleteRule(i);n++;}}}return n})()`);
        console.log(`[danger] mutant: removed ${n} themed danger rule(s)`);
      }
      await js(`document.getElementById('endAllBtn').click()`);
      assert.ok(await until(`!!document.querySelector(${jsLiteral(SEL)})`, 8000), `${tag}: the End all sessions dialog opened`);
      assert.strictEqual(await js(`document.querySelector(${jsLiteral(SEL)}).textContent.trim()`), 'End all sessions', `${tag}: the red button is the confirm button`);
      await H.settle();
      const check = (state, m) => {
        console.log(`[danger] ${tag} ${state}: text rgb(${m.fg}) on rgb(${m.bg}) = ${m.ratio}:1, panel rgb(${m.panel})`);
        assert.ok(m.ratio >= 4.5, `${tag}: danger button ${state} contrast ${m.ratio}:1 is below 4.5:1`);
        assert.ok(m.bg !== m.panel, `${tag}: danger button ${state} is blank: its background rgb(${m.bg}) is the dialog panel's`);
      };
      check('rest', await js(MEASURE(SEL)));
      await js(`document.querySelector(${jsLiteral(SEL)}).focus()`);
      check('focus', await js(MEASURE(SEL)));
      const c = await js(`(()=>{const r=document.querySelector(${jsLiteral(SEL)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
      H.wc().sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y });
      assert.ok(await until(`document.querySelector(${jsLiteral(SEL)}).matches(':hover')`, 3000), `${tag}: the pointer is over the button`);
      await new Promise((r) => setTimeout(r, 400)); // the hover fade
      check('hover', await js(MEASURE(SEL)));
      await H.shot(path.join(OUT, `102-danger-btn-${look.replace(/\W+/g, '-')}-${w}x${h}.png`), { prep: 'none', settle: false, tag: 'danger' });
      await js(`(()=>{const b=document.querySelector(${jsLiteral(SEL)}),k=b.cloneNode(true);k.setAttribute('data-probe','1');k.id='';k.disabled=true;b.parentNode.appendChild(k)})()`);
      H.wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
      await new Promise((r) => setTimeout(r, 400));
      check('disabled', await js(MEASURE('.dlg .btn.primary.danger[data-probe]')));
      await js(`document.querySelector('.dlg .btn.primary.danger[data-probe]').remove()`);
      H.key('Escape');
      assert.ok(await until(`!document.querySelector('.dlg')`, 5000), `${tag}: Escape closes the dialog`);
    }
  }
  console.log('[danger] all checks passed');
};
