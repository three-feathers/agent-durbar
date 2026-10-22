/*
 * Spec 068: coffee break when a usage limit is reached. Simulator only (no credits). Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_DRIVER=$PWD/scripts/shots-068-coffee.js xvfb-run -a npx electron . --no-sandbox
 *
 * simbreak=8: Tomas hits a 5-hour window that resets in 8 s (resumes by itself), Rosa the premium-request quota with no reset time
 * (paid: never by itself), Omar his 30 AIU Durbar cap (until you raise it). The window's waits are shortened for drivers (2 s margin).
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
      const who = n === '15' ? ['Tomas', 'Omar', 'Rosa'] : ['Tomas'];
      for (const nm of who) assert.ok(await until(`(${deskOf(nm)})?.dataset.place==='coffee'`, 20000), `${w} ${n}: ${nm} went to the coffee corner`); /* 20 s: the walk is timed, and a loaded Windows runner is slow */
      await ctx.sleep(1300); // the walk (about 1 s)
      const o = await js(`(()=>{const t=document.querySelector('#stage .place[data-place="coffee"]');const tiles=[...document.querySelectorAll('#stage .lobby .place')];
        const r=x=>x.getBoundingClientRect();const L=r(document.querySelector('#stage .lobby'));
        return {label:t&&t.getAttribute('aria-label'),name:t&&(t.querySelector('.pn')||{}).textContent,named:!!(t&&t.querySelector('.pn')),tiles:tiles.length,inLobby:tiles.every(x=>r(x).right<=L.right+0.5&&r(x).left>=L.left-0.5),
          font:Math.min(...tiles.filter(x=>x.querySelector('.pn')).map(x=>parseFloat(getComputedStyle(x.querySelector('.pn')).fontSize))),
          wide:window.DurbarPlaces.coffeeTile(L.width,tiles.length-1,!!document.querySelector('#stage .place-add')).named,caps:window.DurbarPlaces.tileChips(L.width,tiles.length-1,!!document.querySelector('#stage .place-add'),r(t).width),
          cfFigures:t?t.querySelectorAll('.pv:not(.pv-more)').length:0,
          walkers:document.querySelectorAll('.walker[data-coffee="1"]').length,
          tomas:(${deskOf('Tomas')}).innerText, err:(${deskOf('Tomas')}).className.includes('is-error'),
          sirens:document.querySelectorAll('#stage .siren-light, #stage .amb').length,
          scrollY:document.getElementById('floor').scrollHeight>document.getElementById('floor').clientHeight+1}})()`);
      /* spec 001 FR-034 (2026-10-22): with the office rail the lobby is 1000-1200 px wide; the name shows where it is at least 1100 px */
      if (o.wide) assert.strictEqual(o.name, 'Coffee corner'); else assert.ok(!o.named, `${w} ${n}: icon only where the lobby is narrow`); /* the rule: places.js coffeeTile */
      if (w === 1440) assert.ok(o.wide, `${w} ${n}: the corner is named at 1440x900`);
      assert.ok(/^Coffee corner: /.test(o.label), o.label);
      /* spec 001 FR-036: visitor entries instead of slots; the other places keep room for two visitors (initials), the corner shows a figure */
      assert.ok(o.caps.initials >= 2, `${w} ${n}: every other tile keeps room for two visitors: ${JSON.stringify(o.caps)}`);
      assert.ok(o.cfFigures >= 1, `${w} ${n}: the coffee corner shows at least one visitor, not only "+N"`);
      assert.strictEqual(o.tiles, 6, `${w} ${n}: five places and the coffee corner`);
      assert.ok(o.inLobby, `${w} ${n}: the tiles fit the lobby`);
      assert.ok(o.font >= 10.5, `${w} ${n}: legible tile names (${o.font}px)`);
      assert.ok(/Tomas \(until \d{1,2}:\d\d( [AP]M)?\)/.test(o.label), `${w} ${n}: the corner says who and until when: ${o.label}`);
      if (n === '15') {
        assert.ok(/Omar \(until you raise the limit\)/.test(o.label) && /Rosa \(until the limit resets\)/.test(o.label), o.label);
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
      assert.deepStrictEqual(c.b, ['Try now', 'Stay on break'], JSON.stringify(c));
      assert.ok(/comes back at \d{1,2}:\d\d( [AP]M)? and continues by itself/.test(c.t), c.t);
      await ctx.shot(path.join(OUT, `068-coffee-chat-${w}x${h}.png`));
      // Tomas resumes by itself after the reset (8 s + 2 s margin): back at his desk, one note, the agent works again
      assert.ok(await until(`/Back from the coffee break \\(resumed by itself/.test(document.getElementById('chat').textContent)`, 20000), `${w}: resumed by itself`);
      assert.ok(await until(`(${deskOf('Tomas')})?.dataset.place!=='coffee'`, 5000), `${w}: Tomas left the coffee corner`);
      const sent = await js(`[...document.querySelectorAll('#chat .msg.user, #chat .user')].map(x=>x.textContent).filter(t=>/The usage limit has reset/.test(t)).length`);
      assert.strictEqual(sent, 1, `${w}: exactly one resume message`);
      await js(`document.getElementById('backBtn')&&document.getElementById('backBtn').click()`);
      await ctx.sleep(400);
      // Rosa (paid quota, no reset time): never by herself; Try now before it lifts hits it again and she stays on the break
      await js(`(${deskOf('Rosa')}).click()`);
      await ctx.waitFor(`!!document.querySelector('.note.perm.coffee:not(.settled)')`, 5000);
      const r = await js(`document.querySelector('.note.perm.coffee:not(.settled)').textContent`);
      assert.ok(/did not say when it resets/.test(r) && !/Stay on break/.test(r), r);
      await js(`[...document.querySelectorAll('.note.perm.coffee:not(.settled) button')].find(b=>b.textContent==='Try now').click()`);
      assert.ok(await until(`document.querySelectorAll('.note.perm.coffee').length>=2&&!!document.querySelector('.note.perm.coffee:not(.settled)')`, 5000), `${w}: Rosa hit the limit again and is back on the break`);
      await js(`document.getElementById('backBtn')&&document.getElementById('backBtn').click()`);
      await ctx.sleep(300);
      // the inbox lists the breaks with their buttons
      await js(`document.getElementById('inboxBtn').click()`);
      await ctx.waitFor(`!!document.querySelector('#inboxBody .inbox-row')`, 3000);
      await ctx.sleep(500);
      const ib = await js(`[...document.querySelectorAll('#inboxBody .inbox-row')].map(r=>r.querySelector('.ib-h').textContent.replace(/\\s+/g,' ')).filter(t=>/coffee break/.test(t))`);
      assert.ok(ib.some((t) => /Rosa/.test(t)) && ib.some((t) => /Omar/.test(t)), `${w}: inbox rows: ${JSON.stringify(ib)}`);
      if (w === 1440) await ctx.shot(path.join(OUT, `068-coffee-inbox-${w}x${h}.png`));
      await js(`document.getElementById('inboxClose')&&document.getElementById('inboxClose').click()`);
    }
  }
  console.log('shots-068: coffee break ok');
};
