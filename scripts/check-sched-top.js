/*
 * Spec 044 FR-027..FR-035 (issue #523): the Schedules button in the top bar. Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run check:sched-top
 *
 * At 1440x900 and 1280x800, Expert and Simple, with `simsched=1` (four schedules over two folders; one missed its last run and one
 * failed, hours ago): the button is shown, between the ⋯ button and Needs you, in one row (at most 52px) with nothing overlapping or
 * outside the window and its text at least 10.5px; the count is the active schedules; the word shows in Simple and from 1920px only (Expert),
 * and the accessible name always says "Schedules"; the badge counts the schedules whose last run was missed or failed since the stamp (`durbar.schedSeen`),
 * its words are at most 120 characters; a click opens Settings at the Schedules heading (focused, near the top of Settings' own
 * scroller, the page not scrolled), clears the badge and keeps it cleared after a reload; Pause all dims it, keeps the number and
 * says "all paused"; Ctrl+Shift+S opens the same place from the office, the list and a chat's message box, and does nothing under
 * a dialog; Ctrl+K "sched" Enter does too; the shortcut sheet lists it; the demo hides the button and the palette item; under
 * reduced motion the count does not roll. A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero
 * unless "all checks passed" is printed. Writes 044-topbar-<w>x<h>.png, 044-topbar-simple-<w>x<h>.png and 044-topbar-badge-<w>x<h>.png.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

/* runs in the page: the geometry of the top bar with the button shown */
function barCheck(simple, width) {
  const P = [];
  const R = (e) => e.getBoundingClientRect();
  const vis = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const bar = document.querySelector('.topbar');
  const sc = document.getElementById('schedTopBtn'), more = document.getElementById('topMoreBtn'), ib = document.getElementById('inboxBtn');
  if (!sc || !vis(sc)) return ['the button is not shown'];
  if (R(bar).height > 52.5) P.push(`top bar is ${Math.round(R(bar).height)}px tall (wrapped)`);
  if (R(sc).left < R(more).right) P.push('not right of the ⋯ button');
  if (!vis(ib) || R(sc).right > R(ib).left) P.push('not left of Needs you');
  if (parseFloat(getComputedStyle(sc).fontSize) < 10.5) P.push('text below 10.5px');
  const ctl = [...bar.querySelectorAll('button, select')].filter(vis);
  ctl.forEach((e) => { const b = R(e); if (b.right > innerWidth + 0.5 || b.left < -0.5) P.push('sticks out: ' + (e.id || e.textContent.trim().slice(0, 16))); });
  for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) {
    if (ctl[i].contains(ctl[j]) || ctl[j].contains(ctl[i])) continue;
    const p = R(ctl[i]), q = R(ctl[j]);
    if (Math.min(p.right, q.right) - Math.max(p.left, q.left) > 0.5 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 0.5) P.push(`overlap ${ctl[i].id} x ${ctl[j].id}`);
  }
  const word = sc.querySelector('.st-word'), wordShown = !!word.getClientRects().length;
  const wantWord = simple || width >= 1920; /* the counters' rule: the word shows from 1920px in Expert (2040px on a Mac) */
  if (wordShown !== wantWord) P.push(`the word is ${wordShown ? 'shown' : 'hidden'}, expected ${wantWord ? 'shown' : 'hidden'}`);
  if (!/^Schedules/.test(sc.getAttribute('aria-label') || '')) P.push('aria-label: ' + sc.getAttribute('aria-label'));
  if (sc.getAttribute('aria-keyshortcuts') !== 'Control+Shift+S') P.push('aria-keyshortcuts: ' + sc.getAttribute('aria-keyshortcuts'));
  if ((sc.title || '').length > 120 || (sc.getAttribute('aria-label') || '').length > 120) P.push('title or name over 120 characters');
  /* the folder filter shows its value whole: a select has no ellipsis, so a cut would read "All folde" (scrollWidth cannot tell; measure the text) */
  const sel = document.getElementById('wsFilter'), cs = getComputedStyle(sel), shown = sel.options[sel.selectedIndex].text;
  const cx = document.createElement('canvas').getContext('2d');
  cx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const need = cx.measureText(shown).width, have = sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  if (need > have + 0.5) P.push(`the folder filter cuts "${shown}": text ${Math.round(need)}px in ${Math.round(have)}px`);
  return P;
}

/* runs in the page: the badge disc against what is behind it (WCAG 1.4.11, 3:1), in the colours the page really draws */
function discContrast() {
  const cx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  cx.canvas.width = cx.canvas.height = 1;
  const rgb = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const mark = document.querySelector('#schedTopBtn .st-mark');
  if (!mark || getComputedStyle(mark).display === 'none') return { err: 'no badge' };
  const disc = rgb(getComputedStyle(mark).backgroundColor);
  let behind = [255, 255, 255, 1];
  const stack = [];
  for (let e = document.getElementById('schedTopBtn'); e; e = e.parentElement) stack.unshift(rgb(getComputedStyle(e).backgroundColor));
  for (const c of stack) if (c[3] > 0) { const a = c[3]; behind = [0, 1, 2].map((i) => c[i] * a + behind[i] * (1 - a)).concat([1]); }
  const l1 = lum(disc), l2 = lum(behind), hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  const ratio = (x, y) => { const p = lum(x), q = lum(y); return Math.round(((Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05)) * 100) / 100; };
  /* the drawn "!" is the first colour of the mark's background layers */
  const m = getComputedStyle(mark).backgroundImage.match(/rgba?\([^)]*\)|color\([^)]*\)/);
  const glyph = m ? rgb(m[0]) : null;
  return { ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100, glyphRatio: glyph ? ratio(glyph, disc) : 0, disc, glyph, behind };
}

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  let failed = 0, total = 0;
  const check = (ok, msg) => { total++; if (!ok) { failed++; console.log('FAIL ' + msg); } };
  const state = () => js(`(()=>{const b=document.getElementById('schedTopBtn');return {hidden:b.hidden,label:b.getAttribute('aria-label')||'',title:b.title,count:b.querySelector('b').textContent,paused:b.classList.contains('paused'),trouble:b.classList.contains('trouble'),mark:getComputedStyle(b.querySelector('.st-mark')).display!=='none',none:b.classList.contains('none'),stamp:localStorage.getItem('durbar.schedSeen')}})()`);
  const screenOpen = () => js(`!document.getElementById('screen').hidden&&document.body.classList.contains('screen-open')`);
  const at = () => js(`(()=>{const h=document.getElementById('schH'),sc=h&&h.closest('.scr-body');return h&&sc?{focused:document.activeElement===h,top:Math.round(h.getBoundingClientRect().top-sc.getBoundingClientRect().top),scrolled:sc.scrollTop,page:document.scrollingElement.scrollTop,bodyScroll:document.body.scrollTop}:null})()`);
  const closeScreen = async () => { await H.key('Escape'); await until(`document.getElementById('screen').hidden`); };
  /* load with the seeds; `stamp` is what durbar.schedSeen holds before the page starts ('' = none) */
  const load = async (w, h, level, stamp, query = {}) => {
    await H.load({ w, h, query: { simsched: '1', ...query }, ready: 'fit', settle: false });
    await js(`localStorage.setItem('durbar.detail',${jsLiteral(level)});true`);
    if (stamp === '') await js(`localStorage.removeItem('durbar.schedSeen');true`);
    else await js(`localStorage.setItem('durbar.schedSeen',${jsLiteral(String(stamp))});true`);
    await H.load({ w, h, query: { simsched: '1', ...query }, ready: 'fit', settle: false });
    await until(`!document.getElementById('schedTopBtn').hidden`);
    await H.calm();
    H.wc().focus();
  };
  const shotsDir = process.env.SHOTS_OUT || process.env.OUT || OUT;

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    for (const level of ['expert', 'simple']) {
      const simple = level === 'simple';
      const t0 = Date.now();
      /* no stamp yet: the runs of the last 24 hours count (both seeded runs) */
      await load(w, h, level, '');
      let s = await state();
      check(!s.hidden, `${tag} ${level}: the button is hidden with schedules`);
      check(s.count === '4' && !s.none, `${tag} ${level}: count ${s.count}, expected 4`);
      check(s.trouble && s.mark, `${tag} ${level}: no badge without a stamp (two runs in the last 24 hours)`);
      check(/4 active, next at .+\. 2 schedules missed or failed a run\.$/.test(s.label), `${tag} ${level}: name "${s.label}"`);
      check(/^Schedules: 4 active, next .+\. 2 schedules missed or failed a run \(Ctrl\+Shift\+S\)$/.test(s.title), `${tag} ${level}: title "${s.title}"`);
      const P = await js(`(${barCheck.toString()})(${simple},${w})`);
      check(!P.length, `${tag} ${level}: ${P.join('; ')}`);

      /* a stamp between the two runs: only the newer one counts (the missed run 4 hours ago; the failed one was 6 hours ago) */
      await load(w, h, level, Date.now() - 5 * 3600000);
      s = await state();
      check(s.trouble && s.mark && /1 schedule missed or failed a run\.$/.test(s.label) && /1 schedule missed or failed a run \(/.test(s.title), `${tag} ${level}: stamp 5 h ago: ${s.label}`);
      if (level === 'expert') await H.shot(path.join(shotsDir, `044-topbar-badge-${tag}.png`), { prep: 'mouse', settle: true });

      /* a click: Settings at the Schedules heading, the badge gone, and gone after a reload */
      await js(`document.getElementById('schedTopBtn').click()`);
      check(await until(`!document.getElementById('screen').hidden&&!!document.getElementById('schH')&&document.activeElement===document.getElementById('schH')`), `${tag} ${level}: click did not focus the Schedules heading`);
      await settle();
      const a = await at();
      check(a && a.focused && a.scrolled > 0 && Math.abs(a.top - 12) <= 3 && a.page === 0 && a.bodyScroll === 0, `${tag} ${level}: opened at ${JSON.stringify(a)}`);
      s = await state();
      check(!s.trouble && !s.mark && !!s.stamp && Number(s.stamp) > Date.now() - 60000, `${tag} ${level}: the badge stayed after opening (${JSON.stringify({ t: s.trouble, st: s.stamp })})`);
      check(!/missed/.test(s.label) && !/missed/.test(s.title), `${tag} ${level}: words still mention a missed run: ${s.label}`);
      /* open again while Settings is open: scrolls there again */
      await js(`(()=>{const sc=document.getElementById('schH').closest('.scr-body');sc.scrollTop=0;return true})()`);
      await js(`document.getElementById('schedTopBtn')?document.getElementById('schedTopBtn').click():0`);
      /* (the top bar is behind Settings' own frame? it stays; the click above works the same) */
      await until(`(()=>{const h=document.getElementById('schH');return !!h&&h.closest('.scr-body').scrollTop>0})()`);
      check(((await at()) || {}).scrolled > 0, `${tag} ${level}: opening again did not scroll to Schedules`);
      await closeScreen();
      await load(w, h, level, (await state()).stamp);
      s = await state();
      check(!s.trouble && !s.mark, `${tag} ${level}: the badge came back after a reload`);
      await H.shot(path.join(shotsDir, `044-topbar${simple ? '-simple' : ''}-${tag}.png`), { prep: 'mouse', settle: true });

      /* Pause all: dimmed, the number stays, the words say it */
      await js(`document.getElementById('schedTopBtn').click()`);
      await until(`!!document.getElementById('schedPauseAllSet')`);
      await js(`document.getElementById('schedPauseAllSet').click()`);
      check(await until(`document.getElementById('schedTopBtn').classList.contains('paused')`), `${tag} ${level}: Pause all did not mark the button`);
      s = await state();
      check(s.count === '4' && /all paused, 4 set\./.test(s.label) && /all paused \(4 set\)/.test(s.title), `${tag} ${level}: paused texts ${s.label} / ${s.title}`);
      const dim = await js(`(()=>{const b=document.getElementById('schedTopBtn');return {op:getComputedStyle(b).opacity,glyph:getComputedStyle(b.querySelector('.st-pause')).display}})()`);
      check(Number(dim.op) < 1 && dim.glyph !== 'none', `${tag} ${level}: not dimmed or no pause glyph ${JSON.stringify(dim)}`);
      await js(`document.getElementById('schedPauseAllSet').click()`);
      check(await until(`!document.getElementById('schedTopBtn').classList.contains('paused')`), `${tag} ${level}: switching Pause all off did not restore it`);
      await closeScreen();

      /* the shortcut: from the office, the list view, a chat's message box; nothing under a dialog */
      if (level === 'expert') {
        await load(w, h, level, Date.now());
        const keyOpen = async (where) => {
          await H.key('S', ['control', 'shift'], { char: 'never', pause: 100 });
          const ok = await until(`!document.getElementById('screen').hidden&&document.activeElement===document.getElementById('schH')`);
          check(ok, `${tag}: Ctrl+Shift+S did not open Schedules from ${where}`);
          if (ok) await closeScreen();
        };
        await keyOpen('the office');
        await js(`document.getElementById('vList').click()`);
        await until(`document.getElementById('vList').getAttribute('aria-pressed')==='true'`);
        await keyOpen('the list view');
        await js(`document.getElementById('vOffice').click()`);
        await until(`document.getElementById('vOffice').getAttribute('aria-pressed')==='true'`);
        const chat = await H.openSimAgent('a=>!a.parent', '#msgInput');
        check(chat.ok, `${tag}: no chat to test the shortcut in ${JSON.stringify(chat.seen)}`);
        if (chat.ok) {
          await js(`document.getElementById('msgInput').focus()`);
          await keyOpen("a chat's message box");
          check(await js(`document.body.classList.contains('panel-open')`), `${tag}: the chat closed`);
          await H.key('Escape'); await until(`!document.body.classList.contains('panel-open')`);
        }
        /* under a modal dialog it does nothing: the shortcut sheet */
        await js(`document.getElementById('topMoreBtn').click()`);
        await js(`document.getElementById('kbdHelpBtn').click()`);
        check(await until(`!!document.getElementById('kbdDlg')`), `${tag}: the shortcut sheet did not open`);
        const sheet = await js(`document.getElementById('kbdDlg').innerText`);
        check(/Schedules/.test(sheet) && /Ctrl/.test(sheet), `${tag}: the shortcut sheet has no Schedules row: ${sheet.slice(0, 120)}`);
        await H.key('S', ['control', 'shift'], { char: 'never', pause: 300 });
        check(await js(`document.getElementById('screen').hidden&&!!document.getElementById('kbdDlg')`), `${tag}: Ctrl+Shift+S acted under the shortcut sheet`);
        await H.key('Escape'); await until(`!document.getElementById('kbdDlg')`);

        /* Ctrl+K, "sched", Enter */
        await H.key('K', ['control'], { char: 'never', pause: 100 });
        check(await until(`!!document.getElementById('palIn')`), `${tag}: the palette did not open`);
        await js(`(()=>{const i=document.getElementById('palIn');i.value='sched';i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
        check(await until(`[...document.querySelectorAll('#palList [role="option"]')].some(o=>/Schedules/.test(o.textContent))`), `${tag}: the palette has no Schedules item`);
        await H.key('Return', [], { pause: 100 });
        check(await until(`!document.getElementById('screen').hidden&&document.activeElement===document.getElementById('schH')`), `${tag}: Ctrl+K sched Enter did not open Schedules`);
        await closeScreen();

        /* the demo: no button, no palette item, no shortcut */
        await js(`document.getElementById('topMoreBtn').click()`);
        await js(`(()=>{const t=document.getElementById('demoToggle');t.checked=true;t.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
        check(await until(`document.getElementById('schedTopBtn').hidden`), `${tag}: the button shows in the demo`);
        await H.key('K', ['control'], { char: 'never', pause: 100 });
        await js(`(()=>{const i=document.getElementById('palIn');i.value='sched';i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
        await settle();
        check(await js(`![...document.querySelectorAll('#palList [role="option"]')].some(o=>/^Schedules/.test(o.textContent.trim()))`), `${tag}: the palette lists Schedules in the demo`);
        await H.key('Escape'); await until(`!document.getElementById('palDlg')`);
        await H.key('S', ['control', 'shift'], { char: 'never', pause: 300 });
        check(await js(`document.getElementById('screen').hidden`), `${tag}: Ctrl+Shift+S opened Settings in the demo`);
        await js(`(()=>{const t=document.getElementById('demoToggle');t.checked=false;t.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
        check(await until(`!document.getElementById('schedTopBtn').hidden`), `${tag}: the button did not come back after the demo`);
      }
      console.log(`[sched-top] ${tag} ${level} done in ${Math.round((Date.now() - t0) / 1000)} s`);
    }
  }

  /* FR-033: a new failed run announces once; nothing is announced at start */
  {
    await load(1440, 900, 'expert', '');
    await settle();
    const first = await js(`document.getElementById('srAnnounce').textContent`);
    check(!/did not run/.test(first), 'a scheduled-prompt announcement was made at start: ' + first);
    await js(`window.__ann=[];new MutationObserver(()=>{const t=document.getElementById('srAnnounce').textContent;if(/did not run/.test(t))window.__ann.push(t)}).observe(document.getElementById('srAnnounce'),{childList:true,characterData:true,subtree:true});true`);
    check(await js(`window.__durbarSimSched.fail('sched-s1')`), 'the simulator could not fail a run');
    const heard = await until(`window.__ann.length===1&&/did not run.*Ctrl\\+Shift\\+S/.test(window.__ann[0])`);
    check(heard, 'announcement: ' + JSON.stringify(await js('window.__ann')));
    check((await state()).label.includes('3 schedules missed or failed a run'), 'the name does not say 3 schedules');
    await js(`window.__durbarSimSched.fail('sched-s1')`); /* the same run again: the count does not grow */
    await settle();
    check((await js('window.__ann.length')) === 1, 'the same failed run was announced twice');
  }

  /* FR-029 decisions: Settings opened by its own button leaves the badge up until the Schedules heading is on screen; a failure while it is on screen is seen at once */
  {
    await load(1440, 900, 'expert', '');
    await settle();
    await js(`document.getElementById('settingsBtn').click()`);
    await until(`!document.getElementById('screen').hidden&&!!document.getElementById('schH')`);
    await settle();
    const inView = () => js(`(()=>{const h=document.getElementById('schH'),b=h.closest('.scr-body'),r=h.getBoundingClientRect(),c=b.getBoundingClientRect();return r.top>=c.top&&r.bottom<=c.bottom})()`);
    check(!(await inView()), 'the Schedules heading is already in view in Settings (nothing to test)');
    check((await state()).trouble, 'opening Settings by its own button cleared the badge');
    await js(`(()=>{const h=document.getElementById('schH'),b=h.closest('.scr-body');b.scrollTop+=h.getBoundingClientRect().top-b.getBoundingClientRect().top-12;return true})()`);
    check(await until(`!document.getElementById('schedTopBtn').classList.contains('trouble')`), 'scrolling Schedules into view did not clear the badge');
    check(!!(await state()).stamp, 'no stamp after Schedules came into view');
    await js(`window.__ann=[];new MutationObserver(()=>{const t=document.getElementById('srAnnounce').textContent;if(/did not run/.test(t))window.__ann.push(t)}).observe(document.getElementById('srAnnounce'),{childList:true,characterData:true,subtree:true});true`);
    check(await js(`window.__durbarSimSched.fail('sched-s2')`), 'the simulator could not fail a run');
    await settle();
    const seen = await state();
    const annN = await js('window.__ann.length');
    check(!seen.trouble && !seen.mark && annN === 0, 'a failure in front of the user raised the badge or announced: badge ' + seen.trouble + ', announcements ' + annN);
    await closeScreen();
    check(await js(`window.__durbarSimSched.fail('sched-s1')`), 'the simulator could not fail a run');
    check(await until(`document.getElementById('schedTopBtn').classList.contains('trouble')&&window.__ann.length===1`), 'a failure out of sight did not raise the badge and announce once');
  }

  /* FR-029: a window that is hidden or in the background does not count as looking: the failure raises the badge and announces; coming back with the heading in view clears it */
  {
    await load(1440, 900, 'expert', '');
    await settle();
    await js(`document.getElementById('settingsBtn').click()`);
    await until(`!document.getElementById('screen').hidden&&!!document.getElementById('schH')`);
    await settle();
    await js(`(()=>{const h=document.getElementById('schH'),b=h.closest('.scr-body');b.scrollTop+=h.getBoundingClientRect().top-b.getBoundingClientRect().top-12;return true})()`);
    check(await until(`!document.getElementById('schedTopBtn').classList.contains('trouble')`), 'background test: scrolling Schedules into view did not clear the badge');
    await js(`window.__durbarFocus=()=>false;window.__ann=[];new MutationObserver(()=>{const t=document.getElementById('srAnnounce').textContent;if(/did not run/.test(t))window.__ann.push(t)}).observe(document.getElementById('srAnnounce'),{childList:true,characterData:true,subtree:true});true`);
    check(await js(`window.__durbarSimSched.fail('sched-s2')`), 'the simulator could not fail a run');
    check(await until(`document.getElementById('schedTopBtn').classList.contains('trouble')&&window.__ann.length===1`), 'a failure in an unfocused window did not raise the badge and announce');
    await js(`window.__durbarFocus=()=>true;window.dispatchEvent(new Event('focus'));true`);
    check(await until(`!document.getElementById('schedTopBtn').classList.contains('trouble')`), 'coming back with the heading in view did not clear the badge');
    await js(`delete window.__durbarFocus;true`);
    await closeScreen();
  }

  /* FR-034: widths between 1440 and 1920 stay one row in Expert and Simple with floors and mixed agent apps, also with the Mac room forced */
  for (const level of ['expert', 'simple']) for (const mac of [false, true]) for (const w of [1280, 1440, 1441, 1512, 1600, 1728]) {
    if (w <= 1440 && mac) continue; /* the Mac room at 1280 wraps (known gap); the Mac room at 1440 is covered by shots-052-addleft */
    const hh = w === 1280 ? 800 : 900;
    await H.load({ w, h: hh, query: { simsched: '1', simfloors: '1', simkinds: 'mixed' }, ready: 'fit', settle: false });
    await js(`localStorage.setItem('durbar.detail',${jsLiteral(level)});true`);
    await H.load({ w, h: hh, query: { simsched: '1', simfloors: '1', simkinds: 'mixed' }, ready: 'fit', settle: false });
    await until(`!document.getElementById('schedTopBtn').hidden`);
    if (mac) { await js(`document.documentElement.dataset.platform='darwin';window.DurbarFit&&window.DurbarFit();true`); await js(`new Promise(r=>setTimeout(r,0))`); }
    const P = await js(`(${barCheck.toString()})(${level === 'simple'},${w})`);
    check(!P.length, `${w}px ${level}${mac ? ' with the Mac room' : ''}: ${P.join('; ')}`);
  }
  await js(`localStorage.setItem('durbar.detail','expert');true`);

  /* resizing the window while fitTopbar narrows the folder filter raises no "ResizeObserver loop" error (it runs in the next frame, not inside the observer) */
  {
    await H.load({ w: 1440, h: 900, query: { simsched: '1', simfloors: '1', simkinds: 'mixed' }, ready: 'fit', settle: false });
    await js(`window.__roErr=[];addEventListener('error',e=>{if(/ResizeObserver loop/.test(String(e.message)))window.__roErr.push(String(e.message))});true`);
    for (const w of [1280, 1440, 1100, 1728, 1280, 1440]) {
      ctx.win.setContentSize(w, 800);
      await until(`innerWidth===${Number(w)}`);
      await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    }
    const roErr = await js('window.__roErr');
    check(roErr.length === 0, 'ResizeObserver loop errors during resizes: ' + roErr.join(' | '));
  }

  /* the badge disc holds 3:1 against the button in every built-in theme (WCAG 1.4.11) */
  for (const theme of ['clean', 'corporate', 'retro', 'durbar-indian', 'durbar-european', 'durbar-japanese']) {
    await H.load({ w: 1440, h: 900, query: { simsched: '1', theme }, ready: 'fit', settle: false });
    await js(`localStorage.removeItem('durbar.schedSeen');true`);
    await H.load({ w: 1440, h: 900, query: { simsched: '1', theme }, ready: 'fit', settle: false });
    await until(`document.getElementById('schedTopBtn').classList.contains('trouble')`);
    /* .btn fades its background for 120ms (styles.css): a read taken mid-fade sees the previous theme's white (CI: ratio 1 on Corporate), so wait for the transitions to end and two frames to paint */
    await until(`document.getAnimations().every(a=>a.playState!=='running')`);
    await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const c = await js(`(${discContrast.toString()})()`);
    check(c && c.ratio >= 3, `${theme}: badge disc contrast ${JSON.stringify(c)} (needs 3:1)`);
    check(c && c.glyphRatio >= 3, `${theme}: the "!" against the disc ${JSON.stringify(c)} (needs 3:1)`);
  }

  /* reduced motion (as the OS asks): the count changes at once, no roll boxes */
  {
    const dbg = ctx.win.webContents.debugger;
    dbg.attach('1.3');
    try {
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await load(1440, 900, 'expert', Date.now());
      await js(`document.getElementById('schedTopBtn').click()`);
      await until(`!!document.querySelector('#schedSet [data-ss="pause"]')`);
      await js(`document.querySelector('#schedSet [data-ss="pause"]').click()`);
      await until(`document.querySelector('#schedTopBtn b').textContent==='3'`);
      const roll = await js(`document.querySelector('#schedTopBtn b').children.length`);
      check(roll === 0, `reduced motion: the count rolled (${roll} children)`);
      await closeScreen();
    } finally {
      await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [] }).catch(() => undefined);
      dbg.detach();
    }
  }

  assert.ok(total > 20, 'too few checks ran: ' + total);
  console.log(`[sched-top] ${total - failed}/${total} checks passed`);
  if (failed) throw new Error(`${failed} check(s) failed`);
  console.log('[sched-top] all checks passed');
};
