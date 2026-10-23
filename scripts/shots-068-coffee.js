/*
 * Spec 068: coffee break when a usage limit is reached. Simulator only (no credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_DRIVER=$PWD/scripts/shots-068-coffee.js xvfb-run -a npx electron . --no-sandbox
 *
 * simbreak=8: Tomas hits a 5-hour window that resets in 8 s (resumes by itself), Rosa the premium-request quota with no reset time
 * (paid: never by itself), Omar his 30 AIU Durbar cap (until you raise it; since spec 001 FR-035 he waits at the Bank). The window's waits are shortened for drivers (2 s margin).
 * Delta 2026-10-23 (owner, #634): with simbreak=600 Tomas stays in the corner; his entry is a button (click, Enter), Shift+F10 opens Open chat /
 * Retry now, the chat shows the coffee-break bar, and Retry now (menu, bar, a double press) sends one resume message per break.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers'); /* spec 008 FR-097; jsLiteral: CodeQL js/bad-code-sanitization */
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const deskOf = (name) => `[...document.querySelectorAll('#stage .desk[data-id]')].find(d=>d.innerText.split('\\n').some(l=>l.trim()===${jsLiteral(name)}))`;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const n of ['15', '6']) {
      await H.load({ w, h, query: { sim: n, simbreak: '8' }, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=${n}`, settle: false });
      const who = n === '15' ? ['Tomas', 'Rosa'] : ['Tomas'];
      for (const nm of who) assert.ok(await until(`(${deskOf(nm)})?.dataset.place==='coffee'`, 20000), `${w} ${n}: ${nm} went to the coffee corner`);
      /* spec 001 FR-035 (owner 2026-10-22): Durbar's own cap waits at the Bank, not in the coffee corner */
      if (n === '15') assert.ok(await until(`(${deskOf('Omar')})?.dataset.place==='bank'`, 20000), `${w}: Omar (his Durbar cap) went to the Bank`); /* 20 s: the walk is timed, and a loaded Windows runner is slow */
      await ctx.sleep(1300); // the walk (about 1 s)
      const o = await js(`(()=>{const t=document.querySelector('#stage .place[data-place="coffee"]');const tiles=[...document.querySelectorAll('#stage .lobby .place')];
        const r=x=>x.getBoundingClientRect();const L=r(document.querySelector('#stage .lobby'));
        return {label:t&&t.getAttribute('aria-label'),name:t&&(t.querySelector('.pn')||{}).textContent,named:!!(t&&t.querySelector('.pn')),tiles:tiles.length,inLobby:tiles.every(x=>r(x).right<=L.right+0.5&&r(x).left>=L.left-0.5),
          font:Math.min(...tiles.filter(x=>x.querySelector('.pn')).map(x=>parseFloat(getComputedStyle(x.querySelector('.pn')).fontSize))),
          fit:window.DurbarPlaces.lobbyFit(L.width,5,!!document.querySelector('#stage .place-add'),!!document.querySelector('#stage .place.postbox')),
          cfFigures:t?t.querySelectorAll('.pv:not(.pv-more)').length:0,
          walkers:document.querySelectorAll('.walker[data-coffee="1"]').length,
          tomas:(${deskOf('Tomas')}).innerText, err:(${deskOf('Tomas')}).className.includes('is-error'),
          sirens:document.querySelectorAll('#stage .siren-light, #stage .amb').length,
          scrollY:document.getElementById('floor').scrollHeight>document.getElementById('floor').clientHeight+1}})()`);
      /* spec 001 FR-039 (2026-10-22): the corner's width and name come from places.js lobbyFit (named from 148 px, never a cut name) */
      if (o.fit.coffee.named) assert.strictEqual(o.name, 'Coffee corner'); else assert.ok(!o.named, `${w} ${n}: icon only where the corner is narrow`);
      assert.ok(/^Coffee corner: /.test(o.label), o.label);
      /* spec 001 FR-036: visitor entries instead of slots; the other places keep room for two visitors (initials), the corner shows a figure */
      if (w === 1440) assert.ok(o.fit.caps.initials >= 2, `${w} ${n}: every other tile keeps room for two visitors: ${JSON.stringify(o.fit.caps)}`);
      assert.ok(o.cfFigures >= 1, `${w} ${n}: the coffee corner shows at least one visitor, not only "+N"`);
      assert.strictEqual(o.tiles, 9, `${w} ${n}: five places, the Boss, the coffee corner, the Bank and the Postbox`);
      assert.ok(o.inLobby, `${w} ${n}: the tiles fit the lobby`);
      assert.ok(o.font >= 10.5, `${w} ${n}: legible tile names (${o.font}px)`);
      assert.ok(/Tomas \(until \d{1,2}:\d\d( [AP]M)?( · back in (less than a minute|\d+ min))?\)/.test(o.label), `${w} ${n}: the corner says who, until when and the time left: ${o.label}`);
      if (n === '15') {
        assert.ok(!/Omar/.test(o.label) && /Rosa \(until the limit resets\)/.test(o.label), o.label);
        assert.ok(o.walkers >= 1, `${w}: the figure in the corner holds a cup (${o.walkers}; the rest are the +N)`);
      }
      assert.ok(/Coffee break/.test(o.tomas) && !o.err, `${w} ${n}: Tomas's card says coffee break, not error: ${o.tomas}`);
      assert.ok(!o.scrollY, `${w} ${n}: the office does not scroll`);
      await ctx.shot(path.join(OUT, `068-coffee-office-${n === '15' ? '15' : 'sparse'}-${w}x${h}.png`));
      if (n !== '15') continue;

      // the chat card and the inbox
      await js(`(${deskOf('Tomas')}).click()`);
      await ctx.waitFor(`!!document.getElementById('msgInput')&&!!document.querySelector('#chat .note.perm.coffee:not(.settled)')`, 8000);
      await ctx.sleep(500);
      const c = await js(`(()=>{const n=document.querySelector('.note.perm.coffee:not(.settled)');return {t:n.textContent,b:[...n.querySelectorAll('.note-actions button')].map(x=>x.textContent)}})()`);
      assert.deepStrictEqual(c.b, ['Retry now', 'Stay on break'], JSON.stringify(c)); /* delta 2026-10-23: Try now is Retry now */
      assert.ok(/comes back at \d{1,2}:\d\d( [AP]M)? and continues by itself/.test(c.t), c.t);
      await ctx.shot(path.join(OUT, `068-coffee-chat-${w}x${h}.png`));
      // Tomas resumes by itself after the reset (8 s + 2 s margin): back at his desk, one note, the agent works again
      assert.ok(await until(`/Back from the coffee break \\(resumed by itself/.test(document.getElementById('chat').textContent)`, 20000), `${w}: resumed by itself`);
      assert.ok(await until(`(${deskOf('Tomas')})?.dataset.place!=='coffee'`, 5000), `${w}: Tomas left the coffee corner`);
      const sent = await js(`[...document.querySelectorAll('#chat .msg.user, #chat .user')].map(x=>x.textContent).filter(t=>/The usage limit has reset/.test(t)).length`);
      assert.strictEqual(sent, 1, `${w}: exactly one resume message`);
      await js(`document.getElementById('backBtn')&&document.getElementById('backBtn').click()`);
      await ctx.sleep(400);
      // Rosa (paid quota, no reset time): never by herself; Retry now before it lifts hits it again and she stays on the break
      await js(`(${deskOf('Rosa')}).click()`);
      await ctx.waitFor(`!!document.querySelector('.note.perm.coffee:not(.settled)')`, 5000);
      const r = await js(`document.querySelector('.note.perm.coffee:not(.settled)').textContent`);
      assert.ok(/did not say when it resets/.test(r) && !/Stay on break/.test(r), r);
      await js(`[...document.querySelectorAll('.note.perm.coffee:not(.settled) button')].find(b=>b.textContent==='Retry now').click()`);
      assert.ok(await until(`document.querySelectorAll('.note.perm.coffee').length>=2&&!!document.querySelector('.note.perm.coffee:not(.settled)')`, 5000), `${w}: Rosa hit the limit again and is back on the break`);
      await js(`document.getElementById('backBtn')&&document.getElementById('backBtn').click()`);
      await ctx.sleep(300);
      // the inbox lists the breaks with their buttons
      await js(`document.getElementById('inboxBtn').click()`);
      await ctx.waitFor(`!!document.querySelector('#inboxBody .inbox-row')`, 3000);
      await ctx.sleep(500);
      const ib = await js(`[...document.querySelectorAll('#inboxBody .inbox-row')].map(r=>r.querySelector('.ib-h').textContent.replace(/\\s+/g,' ')).filter(t=>/coffee break/.test(t))`);
      assert.ok(ib.some((t) => /Rosa/.test(t)) && !ib.some((t) => /Omar/.test(t)), `${w}: inbox rows: ${JSON.stringify(ib)}`);
      const lim = await js(`[...document.querySelectorAll('#inboxBody .inbox-row')].map(r=>r.querySelector('.ib-h').textContent.replace(/\\s+/g,' ')).filter(t=>/Omar/.test(t))`);
      assert.ok(lim.length === 1 && /spending limit/.test(lim[0]), `${w}: Omar's inbox row says he reached his spending limit: ${JSON.stringify(lim)}`);
      if (w === 1440) await ctx.shot(path.join(OUT, `068-coffee-inbox-${w}x${h}.png`));
      await js(`document.getElementById('inboxClose')&&document.getElementById('inboxClose').click()`);
    }
  }
  /* Delta 2026-10-23 (owner, #634, FR-019..FR-023): the coffee-break agent is clickable. simbreak=600: Tomas's window resets in 10 min, so
     he stays in the corner with "back in 11 min" (the 2 s driver margin) while the driver clicks, uses the keys and presses Retry now. */
  /* page helpers, installed after each load: Tomas's desk and his coffee-corner entry (no raw splices into page code) */
  const install = () => js(`(()=>{const nm=${jsLiteral('Tomas')};window.__tomas=()=>[...document.querySelectorAll('#stage .desk[data-id]')].find(d=>d.innerText.split('\\n').some(l=>l.trim()===nm));
    window.__entry=()=>{const d=window.__tomas();return d?document.querySelector('#stage .place[data-place="coffee"] [data-coffeeid="'+CSS.escape(d.dataset.id)+'"]'):null;};})()`);
  const resumes = `[...document.querySelectorAll('#chat .msg.user, #chat .user')].map(x=>x.textContent).filter(t=>/The usage limit has reset/.test(t)).length`;
  const byYou = `(document.getElementById('chat').textContent.match(/resumed by you/g)||[]).length`;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await H.load({ w, h, query: { sim: '15', simbreak: '600' }, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=15`, settle: false });
    await install();
    assert.ok(await until(`!!window.__entry()`, 20000), `${w}: Tomas has an entry in the coffee corner`);
    await H.settleWalk();
    // FR-019: a real button with the time left in its title and name; legible; the walker layer takes no clicks
    const e = await js(`(()=>{const b=window.__entry(),r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return {tag:b.tagName,type:b.type,title:b.title,label:b.getAttribute('aria-label'),keys:b.getAttribute('aria-keyshortcuts'),hit:!!hit&&b.contains(hit),
        font:Math.min(...[...b.querySelectorAll('.pv-n,.pv-a')].map(x=>parseFloat(getComputedStyle(x).fontSize))),
        scrollY:document.getElementById('floor').scrollHeight>document.getElementById('floor').clientHeight+1}})()`);
    assert.strictEqual(e.tag, 'BUTTON', `${w}: the coffee-corner entry is a button`);
    assert.ok(e.hit, `${w}: a click on the entry reaches it (no figure on top takes it)`);
    assert.ok(/^Tomas \(until \d{1,2}:\d\d( [AP]M)? · back in ([5-9]|1[01]) min\)\. Open the chat; right-click for Retry now\.$/.test(e.title), `${w}: the title says the time left: ${e.title}`);
    assert.ok(e.title.length <= 120, `${w}: a title within 120 characters (${e.title.length})`);
    assert.ok(/back in ([5-9]|1[01]) min/.test(e.label) && e.keys === 'Shift+F10', `${w}: the accessible name says the time left: ${e.label} (${e.keys})`);
    assert.ok(e.font >= 10.5, `${w}: legible entry text (${e.font}px)`);
    assert.ok(!e.scrollY, `${w}: the office does not scroll`);
    // keyboard: focus the entry with Tab order (it is a button) and open the chat with Enter
    await js(`window.__entry().focus()`);
    await H.key('Enter');
    assert.ok(await until(`/Tomas/.test((document.getElementById('msgInput')||{}).getAttribute?.('aria-label')||'')`, 8000), `${w}: Enter on the entry opens Tomas's chat`);
    // FR-022: the coffee-break bar, always visible; the answer bar does not repeat the card; the card is focused (openAtRequest)
    assert.ok(await until(`!!document.getElementById('coffeeBar')&&!document.getElementById('coffeeBar').hidden`, 5000), `${w}: the coffee-break bar shows`);
    await until(`!!document.activeElement&&document.activeElement.classList.contains('coffee')`, 3000); /* openAtRequest focuses the card a moment after the chat opens */
    const bar = await js(`(()=>{const b=document.getElementById('coffeeBar'),r=b.getBoundingClientRect();return {t:b.innerText.replace(/\\s+/g,' ').trim(),label:b.getAttribute('aria-label'),role:b.getAttribute('role'),
      btn:[...b.querySelectorAll('button')].map(x=>x.textContent),ab:document.getElementById('answerBar').hidden,in:r.bottom<=innerHeight&&r.top>=0&&r.height>0,
      focus:document.activeElement&&document.activeElement.classList.contains('coffee'),ae:document.activeElement?(document.activeElement.id||document.activeElement.className||document.activeElement.tagName):'',
      font:Math.min(...[...b.querySelectorAll('b,span,button')].map(x=>parseFloat(getComputedStyle(x).fontSize)))}})()`);
    assert.ok(/^On a coffee break · back in ([5-9]|1[01]) min/.test(bar.t), `${w}: bar text: ${bar.t}`);
    assert.deepStrictEqual(bar.btn, ['Retry now', 'Show in chat'], `${w}: bar buttons`);
    assert.ok(bar.role === 'region' && /^Coffee break, back in ([5-9]|1[01]) min$/.test(bar.label), `${w}: bar region label: ${bar.label}`);
    assert.ok(bar.ab && bar.in && bar.font >= 10.5, `${w}: answer bar hidden, coffee bar in view, legible: ${JSON.stringify(bar)}`);
    assert.ok(bar.focus, `${w}: the chat opens with the coffee-break card focused (focus: ${bar.ae})`);
    await H.shot(path.join(OUT, `068-coffee-bar-${w}x${h}.png`), { prep: 'calm' });
    await js(`document.getElementById('backBtn').click()`);
    assert.ok(await until(`!document.body.classList.contains('panel-open')`, 3000), `${w}: chat closed`);
    // a mouse click on the entry opens the chat too
    await js(`window.__entry().click()`);
    assert.ok(await until(`!document.getElementById('coffeeBar').hidden&&/Tomas/.test(document.getElementById('msgInput').getAttribute('aria-label'))`, 8000), `${w}: a click on the entry opens Tomas's chat`);
    await js(`document.getElementById('backBtn').click()`);
    await until(`!document.body.classList.contains('panel-open')`, 3000);
    // FR-020: Shift+F10 opens the small menu; arrows move; Escape returns focus to the entry
    await js(`window.__entry().focus()`);
    await H.key('F10', ['shift'], { char: 'never' });
    assert.ok(await until(`!!document.getElementById('modeMenu')`, 3000), `${w}: Shift+F10 opens the coffee menu`);
    const mm = await js(`(()=>{const m=document.getElementById('modeMenu');return {items:[...m.querySelectorAll('[role="menuitem"] b')].map(x=>x.textContent),label:m.getAttribute('aria-label'),focus:document.activeElement&&document.activeElement.dataset.cact}})()`);
    assert.deepStrictEqual(mm.items, ['Open chat', 'Retry now'], `${w}: menu items`);
    assert.ok(mm.focus === 'open' && /^Tomas: Coffee break, back in ([5-9]|1[01]) min$/.test(mm.label), `${w}: menu: ${JSON.stringify(mm)}`);
    await H.key('Down', [], { char: 'never' });
    assert.strictEqual(await js(`document.activeElement.dataset.cact`), 'retry', `${w}: ArrowDown moves to Retry now`);
    if (w === 1440) await H.shot(path.join(OUT, `068-coffee-menu-${w}x${h}.png`), { prep: 'calm' });
    await H.key('Escape', [], { char: 'never' });
    assert.ok(await until(`!document.getElementById('modeMenu')&&document.activeElement===window.__entry()`, 3000), `${w}: Escape closes the menu and focus returns to the entry`);
    // FR-021: Retry now from the menu ends the wait and sends the one resume message, once
    await H.key('F10', ['shift'], { char: 'never' });
    await until(`!!document.getElementById('modeMenu')`, 3000);
    await H.key('Down', [], { char: 'never' });
    await H.key('Enter');
    assert.ok(await until(`!document.getElementById('modeMenu')`, 3000), `${w}: the menu closed`);
    await js(`window.__tomas().click()`);
    assert.ok(await until(`/resumed by you/.test(document.getElementById('chat').textContent)`, 8000), `${w}: Retry now resumed`);
    await ctx.sleep(600);
    assert.strictEqual(await js(resumes), 1, `${w}: Retry now sent exactly one resume message`);
    // the limit had not reset (10 min ahead): the agent app refuses and Tomas is back on the break; now it asks at the reset (re-hit)
    assert.ok(await until(`!!document.querySelector('#chat .note.perm.coffee:not(.settled)')&&!document.getElementById('coffeeBar').hidden`, 8000), `${w}: back on the break`);
    const reHit = await until(`/^On a coffee break · resets in ([5-9]|1[01]) min/.test(document.getElementById('coffeeBar').innerText.replace(/\\s+/g,' ').trim())`, 5000), barNow = await js(`document.getElementById('coffeeBar').innerText`);
    assert.ok(reHit, `${w}: after a re-hit the bar says when it resets (it will ask): ${barNow}`);
    // a double press of the bar's Retry now: one resume message, not two
    await js(`(()=>{const b=document.querySelector('#coffeeBar [data-coffee-retry]');b.click();b.click();})()`);
    assert.ok(await until(`${byYou}>=2`, 5000), `${w}: the bar's Retry now resumed`);
    await ctx.sleep(1500);
    assert.strictEqual(await js(resumes), 2, `${w}: a double press sends one more resume message, not two`);
    assert.strictEqual(await js(byYou), 2, `${w}: one "resumed by you" note per retry`);
    await js(`document.getElementById('backBtn').click()`);
    await ctx.sleep(300);
  }
  console.log('shots-068: coffee break ok');
};
