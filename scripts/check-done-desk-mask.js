/*
 * Check for spec 041 FR-065 (issue #541): text an agent wrote never reaches the office floor unmasked. Simulator only (no AI credits).
 *
 *   npm run check:ui -- --only check-done-desk-mask
 *
 * `simreply=secrets` plants three tokens (`ghp_`, `github_pat_`, `sk-`; built at run time here and in sim.ts) in: every done reply, every
 * sub-agent's task, result and error, a helper's tool starts (`bash --api-key K`, a fetch URL with `?key=K`), an error intent and the titles of
 * the previous sessions. The driver adds, through the page's own event handler, a main agent's tool starts with no intent, a working intent,
 * an error intent and a question. It then reads the whole page except the chat (which shows a reply in full on purpose): the text and every
 * attribute (title, aria-label, ...), case-insensitively, and the agents' stored tasks. None of the tokens, nor a piece of one, nor one
 * with `_` removed, may be there, on: desks, helper cards, the list view, the Needs you inbox, the answer bar, the previous-sessions list,
 * a resumed session and a continued one. A page without the redact module (`noredact=1`) must fail closed: "Finished." on a done desk, Durbar's
 * own words kept, no token. At 1440x900 and 1280x800, Expert and Simple. A miss prints DRIVER FAILED (Electron still exits 0), so the npm
 * script exits non-zero unless "all checks passed" is printed.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const GHP = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const PAT = 'github' + '_pat_' + '11ABCDEFG0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789abcdefghij';
const SK = 's' + 'k-' + 'proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const KEY = 'Kd93' + 'LmP27xQvB' + 'w5Zt';
const NEEDLES = [GHP, PAT, SK, KEY, GHP.replace(/_/g, ''), PAT.replace(/_/g, ''), 'A1b2C3d4', '11ABCDEFG0', 'proj-AbCdEf', 'projAbCdEf', 'Kd93LmP', 'abcdefghijklmn', 'k1l2m3n4', 'ghp', 'github_pat', 'githubpat'].map((x) => x.toLowerCase());
const SCAN = `(()=>{const out=[];const skip=e=>!!e.closest('#chat');
  const w=document.createTreeWalker(document.documentElement,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
  for(let n=w.currentNode;n;n=w.nextNode()){
    if(n.nodeType===3){const p=n.parentElement;if(p&&!skip(p)&&!/^(SCRIPT|STYLE)$/.test(p.tagName))out.push(n.nodeValue);}
    else if(!skip(n))for(const at of n.attributes)out.push(at.value);}
  const ag=(window.__durbarSimUi&&window.__durbarSimUi.agents())||[];
  for(const a of ag)out.push(String(a.task||''));
  for(const t of (window.__taskLog||[]))out.push(String(t));
  return out.join('\\n').toLowerCase();})()`;
module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const scan = async (tag, what) => {
    const page = await js(SCAN);
    for (const nd of NEEDLES) assert.ok(!page.includes(nd), `${tag}: "${nd.slice(0, 10)}..." is on the page (${what}): ...${page.slice(Math.max(0, page.indexOf(nd) - 60), page.indexOf(nd) + 40).replace(/\n/g, ' ')}...`);
  };
  const emit = (ev) => js(`window.__durbarSimUi.emit(JSON.parse(${jsLiteral(JSON.stringify(ev))}))`);
  // the feeds of review #567: permission lines, a runtime title, a sub-agent's name and type, tokens broken up by Markdown
  const TAIL = GHP.slice(4), SKTAIL = SK.slice(8);
  const feeds = async (ids, ts) => {
    await emit({ type: 'status', sessionId: ids[0], timestamp: ts, status: 'needs-permission', intent: 'Waiting for permission: run curl --api-key ' + KEY + ' https://example.test/a' });
    await emit({ type: 'status', sessionId: ids[1], timestamp: ts, status: 'working', intent: 'Allowed: fetch https://example.test/a?key=' + KEY });
    await emit({ type: 'title', sessionId: ids[2], timestamp: ts, title: 'Rotate ' + GHP + ' and ' + PAT });
    await emit({ type: 'subagent', sessionId: ids[3], timestamp: ts, subagentId: 'sx1', name: 'helper ' + GHP, phase: 'started', task: 'look around', agentName: 'type ' + SK, model: 'm' });
    await emit({ type: 'status', sessionId: ids[4], timestamp: ts, status: 'working', intent: 'Using gh`p_' + TAIL + '` and sk-proj_*' + SKTAIL + '*' });
    await emit({ type: 'toolCall', sessionId: ids[4], timestamp: ts, callId: 'tt1', tool: 'task', phase: 'start', args: { agent_type: 'agent-' + SK, prompt: 'scan' } });
    await emit({ type: 'subagent', sessionId: ids[4], timestamp: ts, subagentId: 'tt1', name: 'scan', phase: 'started', task: 'scan', model: 'm' });
    await emit({ type: 'status', sessionId: ids[5], timestamp: ts, status: 'working', intent: 'x' });
    await emit({ type: 'output', sessionId: ids[5], timestamp: ts, delta: 'Replying: saved ghp\\_' + TAIL + ' and gh`p_' + TAIL + '` to the vault. ' });
    await emit({ type: 'output', sessionId: ids[5], timestamp: ts, delta: '', final: true, text: 'Saved ghp\\_' + TAIL + ' and gh`p_' + TAIL + '` to the vault. Also ' + GHP.slice(0, 24) + '**' + GHP.slice(24) + '** (split late).' });
    await emit({ type: 'status', sessionId: ids[5], timestamp: ts, status: 'idle' });
  };
  const back = async () => { await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click();})()`); await until(`!document.body.classList.contains('panel-open')`); };
  const sendFailStep = async () => {
    const id = await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>!x.parent&&x.live);return a?a.id:''})()`);
    assert.ok(id, 'sendfail: a live agent');
    await js(`document.querySelector('#stage .desk[data-id='+JSON.stringify(${jsLiteral(id)})+']').click()`);
    await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('msgInput')`);
    await until(`(()=>{const v=e=>!!e&&e.getClientRects().length>0;return v(document.getElementById('sendBtn'))})()`, 15000);
    await js(`(()=>{const m=document.getElementById('msgInput');m.focus();m.value='hello';m.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
    assert.ok(await until(`[...document.querySelectorAll('#chat .note')].some(n=>/Send failed/.test(n.textContent))`, 6000), 'sendfail: no "Send failed" note');
    const note = (await js(`[...document.querySelectorAll('#chat .note')].filter(n=>/Send failed/.test(n.textContent)).map(n=>n.textContent+' '+[...n.querySelectorAll('*')].concat(n).map(e=>[...e.attributes].map(a=>a.value).join(' ')).join(' ')).join(' | ')`)).toLowerCase();
    for (const nd of NEEDLES) assert.ok(!note.includes(nd), `sendfail: "${nd.slice(0, 10)}..." shows in the note: ${note.slice(0, 200)}`);
    assert.ok(/\[redacted\]/.test(note) && /refused the message/.test(note), 'sendfail: the note keeps the error, masked: ' + note.slice(0, 160));
    await back();
  };
  const ONLY = process.env.DM_ONLY || ''; // DM_ONLY=lounge or sendfail runs that step alone (to prove it catches a raw text by itself)
  for (const [w, h] of ONLY ? [] : [[1440, 900], [1280, 800]]) {
    for (const level of ['expert', 'simple']) {
      const Q = { simreply: 'secrets', simsched: '1' };
      await H.load({ w, h, query: Q, ready: 'fit', settle: false });
      await js(`localStorage.setItem('durbar.detail',${jsLiteral(level)})`);
      await H.load({ query: Q, ready: 'fit' });
      const tag = `${w} ${level}`;
      // 1. desks and helper cards with what the simulator planted
      const seen = await js(`(()=>{const done=[...document.querySelectorAll('#stage .desk.is-done')];
        return {n:done.length,masked:done.filter(d=>/Done: Done\\. Token check: \\[redacted\\]/.test(d.title)||/Done\\. Token check: \\[redacted\\]/.test(d.getAttribute('aria-label')||'')).length,helpers:document.querySelectorAll('#stage .helper').length,open:document.body.classList.contains('panel-open')};})()`);
      assert.ok(seen.n > 0 && seen.masked > 0 && !seen.open, `${tag}: done desks show the masked reply: ${JSON.stringify(seen)}`);
      assert.ok(seen.helpers > 0, `${tag}: helper cards are on the floor`);
      assert.ok(await until(`(()=>{const e=document.getElementById('awayStrip');return !!e&&!e.hidden&&/scheduled prompt/.test(e.textContent)})()`, 8000), `${tag}: the welcome-back card lists the missed schedule`);
      const away = await js(`document.getElementById('awayStrip').textContent`);
      assert.ok(/mcp-swiss/.test(away), `${tag}: the card names the folder: ${away.slice(0, 200)}`);
      await scan(tag, 'desks and helper cards');
      // 2. a main agent: tool starts with no intent (command and URL), a working intent, an error intent. These skip the helper on purpose
      const main = await js(`(()=>{const a=window.__durbarSimUi.agents().filter(x=>!x.parent&&x.live);return a.map(x=>x.id)})()`);
      assert.ok(main.length >= 3, `${tag}: live main agents (${main.length})`);
      const [m1, m2, m3] = main;
      const ts = Date.now();
      await js(`window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(m1)}).intent=''`);
      await emit({ type: 'toolCall', sessionId: m1, timestamp: ts, callId: 'x1', tool: 'bash', phase: 'start', args: { command: 'curl --api-key ' + KEY + ' https://example.test/a' } });
      await scan(tag, 'tool start, command');
      await js(`window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(m1)}).intent=''`);
      await emit({ type: 'toolCall', sessionId: m1, timestamp: ts, callId: 'x2', tool: 'web_fetch', phase: 'start', args: { url: 'https://example.test/a?key=' + KEY } });
      await scan(tag, 'tool start, URL');
      await emit({ type: 'status', sessionId: m2, timestamp: ts, status: 'working', intent: 'Using ' + GHP + ' and ' + PAT + ' and ' + SK });
      const st2 = await js(`window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(m2)}).task`);
      assert.ok(/\[redacted\]/.test(st2) && !NEEDLES.some((nd) => st2.toLowerCase().includes(nd)), `${tag}: the stored task is masked even when the path skips the helper: ${JSON.stringify(st2)}`);
      await scan(tag, 'working intent (setState backstop)');
      await emit({ type: 'status', sessionId: m3, timestamp: ts, status: 'error', intent: 'Checking the registry module and its tests. '.repeat(4).slice(0, 132) + ' ' + GHP + ' and ' + PAT + ' and ' + SK });
      await scan(tag, 'error intent');
      assert.ok(main.length >= 9, `${tag}: enough live main agents for the feeds (${main.length})`);
      await feeds(main.slice(3, 9), ts);
      const perm = await js(`window.__durbarSimUi.agents().filter(x=>/^(Waiting for permission|Allowed): (run|fetch)/.test(x.task||'')).map(x=>x.task)`);
      assert.ok(perm.length >= 2 && perm.every((t) => /\[redacted\]/.test(t) && !t.toLowerCase().includes(KEY.toLowerCase())), `${tag}: the permission lines are stored masked: ${JSON.stringify(perm)}`);
      await scan(tag, 'permission lines, runtime title, sub-agent name, Markdown-split tokens');
      // 2a. the lobby (spec 001 FR-034..FR-040): the tiles' chips and titles, the Boss queue, and the navigator (Ctrl+F, ⌘F on a Mac; spec 074 since 2026-10-23)
      assert.ok(await until(`document.querySelectorAll('.lobby .pv').length>0`, 15000), `${tag}: agents stand in the lobby`);
      if (level === 'expert') await until(`[...document.querySelectorAll('.lobby .pv')].some(e=>/curl|fetch|example\\.test/i.test(e.textContent+' '+e.title+' '+(e.getAttribute('aria-label')||'')))`, 8000);
      const lob = await js(`(()=>{const pv=[...document.querySelectorAll('.lobby .pv')];return {n:pv.length,boss:document.querySelectorAll('.lobby .place.boss .pv').length,
        words:pv.map(e=>e.textContent+' '+e.title+' '+(e.getAttribute('aria-label')||'')).join(' ').toLowerCase(),places:[...document.querySelectorAll('.lobby .place')].map(e=>e.title+' '+(e.getAttribute('aria-label')||'')).join(' ').toLowerCase()}})()`);
      assert.ok(lob.boss > 0, `${tag}: the Boss queue holds the waiting agents`);
      if (level === 'expert') assert.ok(lob.words.includes('curl') || lob.words.includes('fetch') || lob.words.includes('example.test'), `${tag}: a lobby chip shows what its agent is doing (so a raw label would show): ${lob.words.slice(0, 200)}`);
      for (const nd of NEEDLES) assert.ok(!lob.words.includes(nd) && !lob.places.includes(nd), `${tag}: "${nd.slice(0, 10)}..." is on a lobby tile or its title`);
      await scan(tag, 'lobby tiles');
      // the Postbox (the schedule prompts hold the planted secrets, cut where a cut-before-mask would leave a piece) and a token-named agent in the lobby
      const pb = await js(`(()=>{const e=document.querySelector('.lobby .place.postbox');return e?(e.title+' '+(e.getAttribute('aria-label')||'')).toLowerCase():''})()`);
      assert.ok(/next:/.test(pb), `${tag}: the Postbox lists the next letters: ${pb.slice(0, 160)}`);
      for (const nd of NEEDLES) assert.ok(!pb.includes(nd), `${tag}: "${nd.slice(0, 10)}..." is on the Postbox`);
      const named = await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>!x.parent&&/redacted/i.test(x.name||''));return a?a.id:''})()`);
      assert.ok(named, `${tag}: an agent named after the planted runtime title (masked)`);
      await emit({ type: 'toolCall', sessionId: named, timestamp: ts, callId: 'lb1', tool: 'bash', phase: 'start', args: { command: 'npm test' } });
      assert.ok(await until(`!!document.querySelector(${jsLiteral('.lobby .pv[data-visitor="' + named + '"]')})||!!document.querySelector('.lobby .pv-more')`, 8000), `${tag}: the token-named agent stands in the lobby (chip or +N)`);
      if (await js(`!document.querySelector(${jsLiteral('.lobby .pv[data-visitor="' + named + '"]')})`)) {
        await js(`document.querySelector('.lobby .pv-more').click()`); // the +N list
        await ctx.sleep(200);
        await scan(tag, 'the +N menu of a lobby place');
        await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      }
      await scan(tag, 'token-named agent at a lobby place (chip, + menu, place tooltips)');
      await H.key('F', [process.platform === 'darwin' ? 'meta' : 'control'], { char: 'never' });
      assert.ok(await until(`!!document.getElementById('palDlg')`, 5000), `${tag}: the navigator opens with Ctrl+F (⌘F)`);
      await scan(tag, 'navigator, first level');
      await js(`(()=>{const i=document.getElementById('palIn');i.value='c ';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await until(`document.querySelectorAll('#palDlg [role=option],#palDlg .pal-row,#palDlg li').length>0`, 3000);
      await scan(tag, 'navigator, chats');
      // Go to on the agents level: a folder with several chats
      await js(`(()=>{const i=document.getElementById('palIn');i.value='f ';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      let atAgents = false;
      for (let n = 1; n <= 8 && !atAgents; n++) {
        if (!(await js(`!!document.getElementById('palDlg')`))) { await H.key('F', [process.platform === 'darwin' ? 'meta' : 'control'], { char: 'never' }); await until(`!!document.getElementById('palDlg')`, 3000); await js(`(()=>{const i=document.getElementById('palIn');i.value='f ';i.dispatchEvent(new Event('input',{bubbles:true}));})()`); }
        await js(`(()=>{const i=document.getElementById('palIn');i.value=${jsLiteral(String(n))};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        await ctx.sleep(150);
        if (await js(`(document.getElementById('palCrumb')||{textContent:''}).textContent.split('›').length>=3`)) atAgents = true;
        else if (!(await js(`!!document.getElementById('palDlg')`))) await back();
      }
      assert.ok(atAgents, `${tag}: Go to reached an agents level`);
      await scan(tag, 'Go to, agents level');
      await js(`(document.getElementById('palIn')||{focus(){}}).focus()`);
      for (let k = 0; k < 6 && (await js(`!!document.getElementById('palDlg')`)); k++) await H.key('Escape', [], { char: 'never' }); // Escape steps back one level, then closes
      assert.ok(await until(`!document.getElementById('palDlg')`, 3000), `${tag}: Escape closes the navigator`);
      // 2b. a sub-agent's card in its parent's chat (the chat shows a reply in full; the card's one-line summary is masked)
      const parent = await js(`(()=>{const h=window.__durbarSimUi.agents().find(x=>x.parent);return h?h.parent:''})()`);
      assert.ok(parent, `${tag}: a helper has a parent`);
      await js(`(()=>{const d=document.querySelector('#stage .desk[data-id='+JSON.stringify(${jsLiteral(parent)})+']');d.click();})()`);
      await until(`document.querySelectorAll('#chat .sub-task').length>0`);
      const sub = await js(`[...document.querySelectorAll('#chat .sub-task')].map(e=>e.textContent+' '+(e.title||'')).join('\\n').toLowerCase()`);
      assert.ok(sub.length > 0 && /\[redac/.test(sub), `${tag}: sub-agent card lines exist and show a masked secret: ${sub.slice(0, 200)}`);
      for (const nd of NEEDLES) assert.ok(!sub.includes(nd), `${tag}: "${nd.slice(0, 10)}..." is in a sub-agent card line: ${sub.slice(0, 200)}`);
      await back();
      // 3. a question with the tokens: the Needs you inbox and the answer bar
      await emit({ type: 'question', sessionId: m2, timestamp: ts, phase: 'asked', requestId: 'q-secret', questions: [{ question: 'Shall I keep ' + GHP + ' and ' + PAT + ' and ' + SK + ' in the file?', header: 'Secrets', multiSelect: false, options: [{ label: 'Yes' }, { label: 'No' }] }] });
      await until(`!!document.querySelector(${jsLiteral('#stage .desk[data-id="' + m2 + '"]')})`);
      await js(`document.getElementById('inboxBtn').click()`);
      await until(`document.querySelectorAll('.ib-t').length>0`);
      assert.ok(await js(`[...document.querySelectorAll('.ib-t')].some(e=>/\\[redacted\\]/.test(e.textContent))`), `${tag}: the inbox shows the question, masked`);
      await scan(tag, 'Needs you inbox');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      // the asking agent's own chat, with the question scrolled out of view: the answer bar repeats it
      await emit({ type: 'output', sessionId: m2, timestamp: ts, delta: 'Long note.\n\n'.repeat(80), final: true, text: 'Long note.\n\n'.repeat(80) });
      await js(`(()=>{const d=document.querySelector(${jsLiteral('#stage .desk[data-id="' + m2 + '"]')});if(d)d.click();})()`);
      await until(`document.body.classList.contains('panel-open')&&!!document.querySelector('#chat .note.perm')`);
      assert.ok(await until(`(()=>{const c=document.getElementById('chat');c.scrollTop=0;c.dispatchEvent(new Event('scroll'));return true})()&&!!document.getElementById('answerBar')&&!document.getElementById('answerBar').hidden&&/\\[redacted\\]/.test(document.getElementById('answerBar').textContent)`, 20000), `${tag}: the answer bar shows the question, masked`);
      await scan(tag, 'answer bar and panel header');
      await back();
      // 4. the list view
      await js(`document.getElementById('vList').click()`); await until(`document.querySelectorAll('#list button.lrow').length>=15`);
      await scan(tag, 'list view');
      await js(`document.getElementById('vOffice').click()`); await until(`document.querySelectorAll('#stage .desk[data-id]').length>=15`);
      // 5. previous sessions, then a resumed one
      await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>/Ada/.test(x.innerText));d.click();})()`);
      await until(`!!document.getElementById('prevBtn')&&!document.getElementById('prevBtn').hidden`);
      if (!(await js(`!!document.querySelector('#prev .prev-row')`))) await js(`document.getElementById('prevBtn').click()`);
      await until(`document.querySelectorAll('#prevLists .prev-row').length>=2`);
      await until(`[...document.querySelectorAll('#prevLists .prev-t')].some(e=>/\\[redacted\\]/.test(e.textContent))`).catch(() => {});
      const titles = await js(`[...document.querySelectorAll('#prevLists .prev-t')].map(e=>e.textContent).join(' | ')`);
      assert.ok(/\[redacted\]/.test(titles), `${tag}: a previous session title shows masked: ${titles}`);
      await scan(tag, 'previous-sessions list');
      await js(`document.querySelector('#prevLists [data-pv="resume"]').click()`);
      await until(`window.__durbarSimUi.agents().some(a=>/^Resumed/.test(a.task||''))`);
      assert.ok(await js(`(window.__taskLog||[]).some(t=>/^Resumed/.test(t))`), `${tag}: a resumed line was stored`);
      await back();
      await scan(tag, 'resumed session');
    }
  }
  if (!ONLY) {
  // 5b. a grown desk (spec 001 FR-041..FR-047): with few agents a card grows and shows the start of its last reply
  await H.load({ w: 1440, h: 900, query: { sim: '3', simreply: 'secrets', simsched: '1' }, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=3&&document.getElementById('stage').dataset.fit` });
  const gm = await js(`window.__durbarSimUi.agents().filter(x=>!x.parent&&x.live).map(x=>x.id)`);
  assert.ok(gm.length >= 2, 'grown: live agents');
  const longReply = 'Report: ' + 'every link resolves and the tests pass. '.repeat(14).slice(0, 560) + ' ' + GHP + ' ' + PAT + ' and then ' + SK;
  for (const id of gm.slice(0, 2)) {
    await emit({ type: 'status', sessionId: id, timestamp: Date.now(), status: 'working', intent: 'x' });
    await emit({ type: 'output', sessionId: id, timestamp: Date.now(), delta: '', final: true, text: longReply });
    await emit({ type: 'status', sessionId: id, timestamp: Date.now(), status: 'idle' });
  }
  if (gm[2]) { // a working desk streams its reply: the grown desk's text is made from the masked body
    await emit({ type: 'status', sessionId: gm[2], timestamp: Date.now(), status: 'working', intent: 'x' });
    await emit({ type: 'output', sessionId: gm[2], timestamp: Date.now(), delta: 'Replying with a long streamed answer. ' + 'Every link resolves. '.repeat(8) + 'The key is ' + GHP + ' and ' + SK + '. ' });
  }
  assert.ok(await until(`!!document.getElementById('stage').dataset.grow`, 8000), 'grown: the stage grew its desks');
  assert.ok(await until(`[...document.querySelectorAll('#stage .desk.card .intent, #stage .desk.card .gx-t')].some(e=>/every link resolves/.test(e.textContent))`, 8000), 'grown: a desk shows the start of its reply');
  await scan('grown', 'grown desks: reply line and reply column');
  }
  if (ONLY !== 'sendfail') {
  // 5c. the lounge (spec 001 FR-051..FR-057): the couch bubble, the dream cloud and its tooltip, the peek card and the tooltips and labels cut a reply at 160, 90, 300 and 140
  await H.load({ w: 1440, h: 900, query: { sim: '7', simrooms: '1', simhelpers: '0', simreply: 'secrets' }, ready: `document.querySelectorAll('#stage .desk[data-id]').length>=7&&document.getElementById('stage').dataset.fit` });
  const pad = (n) => 'Checking the registry module and its tests. '.repeat(8).slice(0, n - 1) + ' ';
  const TL = GHP.slice(4);
  const replies = [pad(155) + GHP + ' end', pad(135) + GHP + ' end', pad(295) + GHP + ' end', pad(85) + GHP + ' end',
    pad(100) + GHP.slice(0, 24) + '**' + GHP.slice(24) + '** end', pad(130) + 'gh`p_' + TL + '` end'];
  const mins = [2, 4, 6, 25, 50, 70];
  for (let i = 0; i < 6; i++) {
    const id = 'sim-' + (i + 1);
    await emit({ type: 'status', sessionId: id, timestamp: Date.now(), status: 'working', intent: 'Working' });
    await emit({ type: 'output', sessionId: id, timestamp: Date.now(), delta: '', final: true, text: replies[i] });
    await emit({ type: 'status', sessionId: id, timestamp: Date.now(), status: 'idle' });
  }
  await js(`window.__durbarSimUi.readAll()`); // #691: an unread agent keeps its desk; this step is about the lounge, so the replies count as read
  for (let i = 0; i < 6; i++) await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral('sim-' + (i + 1))});a.lastEventAt=Date.now()-${jsLiteral(mins[i])}*60000;})()`);
  // wait for the split (3 on the couch, 3 on the beds), drawing again while we wait: a slow runner has not laid the lounge out yet
  const split = `(()=>{window.__durbarSimUi.render();return document.querySelectorAll('#stage .desk.shut.rest-recent').length===3&&document.querySelectorAll('#stage .desk.shut.rest-old').length===3})()`;
  const splitOk = await until(split, 10000);
  const counts = await js('JSON.stringify({recent:document.querySelectorAll("#stage .desk.shut.rest-recent").length,old:document.querySelectorAll("#stage .desk.shut.rest-old").length})');
  assert.ok(splitOk, 'lounge: 3 on the couch and 3 on the beds: ' + counts);
  await scan('lounge', 'lounge: couch, beds, peek cards, tooltips');
  for (let k = 0; k < 4; k++) { await js(`window.__durbarSimUi.loungeTurn()`); assert.ok(await until(split, 10000), `lounge after turn ${k + 1}: the split holds`); await ctx.sleep(120); await scan('lounge', 'lounge after turn ' + (k + 1)); }
  if (ONLY === 'lounge') { console.log('[done-desk-mask] all checks passed'); return; }
  }
  if (ONLY !== 'sendfail') {
  // 6. a restored session continued (simresume=1)
  await H.load({ w: 1440, h: 900, query: { simreply: 'secrets', simresume: '1' }, ready: 'fit' });
  const r = await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.info&&x.info.resumeLast);return a?a.id:''})()`);
  assert.ok(r, 'an agent with a session to continue');
  await js(`document.querySelector('#stage .desk[data-id='+JSON.stringify(${jsLiteral(r)})+']').click()`);
  await until(`window.__durbarSimUi.agents().some(a=>/^Continued/.test(a.task||''))`);
  assert.ok(await js(`(window.__taskLog||[]).some(t=>/^Continued/.test(t))`), 'a continued line was stored');
  await back();
  await scan('continued', 'continued session');
  }
  // 6b. a send the agent app refuses with an error that holds token shapes (simsendfail=secret; spec 041 FR-065 delta 2026-10-23, issue #608
  //     review): the chat's "Send failed" note shows the error masked. The office SCAN skips #chat, so the note is read on its own.
  await H.load({ w: 1440, h: 900, query: { simsendfail: 'secret' }, ready: 'fit' });
  await sendFailStep();
  if (ONLY === 'sendfail') { console.log('[done-desk-mask] all checks passed'); return; }
  // 6c. sparse offices with expanded helper cards (spec 001 FR-090, issue #697, T120): two and three parents in one room, helpers with the planted
  //     secrets (task, result, error, activity; simreply=secrets), and, through the page's handler, an activity, a result and an error whose token
  //     starts just before the card's 240-character cut. Expert and Simple, both sizes; then noredact=1 (fail closed: Durbar's own words only).
  //     The whole page except the chat is scanned (text and every attribute): the cards' lines, title and aria-label included.
  {
    const PAD = (n) => 'Checking the registry module and its tests. '.repeat(8).slice(0, n - 1) + ' ';
    const SECRETS = 'Token check: ' + GHP + ' and ' + PAT + ' and ' + SK + '.';
    for (const redact of [true, false]) {
      for (const [w, h] of [[1440, 900], [1280, 800]]) {
        for (const level of ['expert', 'simple']) {
          for (const [n, hp] of [[2, 3], [3, 2]]) {
            const Q = { sim: String(n), simrooms: '1', simhelpers: String(hp), simreply: 'secrets', ...(redact ? {} : { noredact: '1' }) };
            const tag = `sparse ${n}x${hp} ${w} ${level}${redact ? '' : ' noredact'}`;
            await H.load({ w, h, query: Q, ready: 'fit', settle: false });
            await js(`localStorage.setItem('durbar.detail',${jsLiteral(level)})`);
            await H.load({ query: Q, ready: 'fit' });
            assert.ok(await until(`document.querySelectorAll('#stage .helper.hx').length===${jsLiteral(n * hp)}`, 10000), `${tag}: the expanded cards are on the floor`);
            await scan(tag, 'expanded helper cards, planted by the simulator');
            for (const at of [236, 238, 239, 240, 244]) { // the planted token starts at character `at` of the field, around the cut
              const id1 = 'sim-1', c0 = id1 + '-task0';
              await emit({ type: 'status', sessionId: id1, agentId: c0, timestamp: Date.now(), status: 'working', intent: PAD(at) + SECRETS });
              await emit({ type: 'toolCall', sessionId: id1, agentId: c0, timestamp: Date.now(), callId: 'mk' + at, tool: 'bash', phase: 'start', args: { command: 'curl --api-key ' + KEY + ' ' + PAD(at) + GHP } });
              await emit({ type: 'toolCall', sessionId: 'sim-2', timestamp: Date.now(), callId: 'sim-2-task1', tool: 'task', phase: 'complete', output: PAD(at) + SECRETS });
              if (hp === 3) await emit({ type: 'toolCall', sessionId: id1, timestamp: Date.now(), callId: id1 + '-task2', tool: 'task', phase: 'failed', output: PAD(at) + SECRETS });
              await emit({ type: 'subagent', sessionId: 'sim-2', timestamp: Date.now(), subagentId: 'sim-2-task0', phase: 'started', task: PAD(at) + SECRETS, model: 'm ' + GHP });
              await H.settle();
              await scan(tag, `activity, result, error, task and model with a token starting at ${at}`);
            }
            const seen = await js(`(()=>{const c=[...document.querySelectorAll('#stage .helper.hx')];return {n:c.length,text:c.map(x=>x.innerText).join(' | ')}})()`);
            assert.strictEqual(seen.n, n * hp, `${tag}: cards ${seen.n}`);
            if (redact) assert.ok(/\[redacted\]/.test(seen.text), `${tag}: the planted tokens read [redacted] on a card: ${seen.text.slice(0, 200)}`);
            else assert.ok(!/Token check|registry module|strict-null/.test(seen.text) && /Finished\.|Failed\.|Working\.|Task hidden\./.test(seen.text), `${tag}: with no redact module a card shows Durbar's own words only: ${seen.text.slice(0, 200)}`);
            if (level === 'simple') assert.ok(!/curl|api-key|example\.test/i.test(seen.text), `${tag}: Simple never shows a command: ${seen.text.slice(0, 200)}`);
          }
        }
      }
    }
    await js(`localStorage.removeItem('durbar.detail')`);
  }
  // 7. no redact module: fail closed, Durbar's own words stay
  await H.load({ w: 1440, h: 900, query: { simreply: 'secrets', simsched: '1', noredact: '1' }, ready: 'fit' });
  const nr = await js(`(()=>({fin:window.__durbarSimUi.agents().filter(a=>a.task==='Finished.').length,done:[...document.querySelectorAll('#stage .desk.is-done')].map(d=>d.title),page:document.body.innerText}))()`);
  assert.ok(nr.done.length > 0 && nr.fin > 0, `noredact: done desks exist and their line is "Finished.": ${JSON.stringify(nr)}`);
  assert.ok(/Thinking/.test(nr.page), 'noredact: Durbar\'s own "Thinking" stays');
  // Durbar's own prefixes must not carry agent text through when redact is missing
  const nm = await js(`window.__durbarSimUi.agents().filter(x=>!x.parent&&x.live).map(x=>x.id)`);
  for (const [i, pre] of ['Stopped at ', 'Continued: ', 'Resumed: ', 'Send failed: ', 'Continuing after '].entries()) {
    await emit({ type: 'status', sessionId: nm[i], timestamp: Date.now(), status: 'working', intent: pre + GHP + ' ' + PAT + ' ' + SK });
  }
  assert.ok(nm.length >= 9, 'noredact: enough agents');
  await feeds(nm.slice(3, 9), Date.now());
  assert.ok(await js(`window.__durbarSimUi.agents().some(x=>x.task==='Waiting for permission')`), 'noredact: a permission line reads "Waiting for permission" and nothing more');
  await scan('noredact', 'no redact module');
  // 8. safetext.js does not load: the page still draws, shows no agent text, and keeps its own words
  await js(`0`);
  ctx.win.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*safetext.js', 'file:///*safetext.js'] }, (d, cb) => cb({ cancel: true }));
  await H.load({ w: 1440, h: 900, query: { simreply: 'secrets' }, ready: 'fit' });
  const ns = await js(`(()=>({fin:(window.__durbarSimUi?window.__durbarSimUi.agents():[]).filter(a=>a.task==='Finished.').length,st:typeof window.DurbarSafeText,desks:document.querySelectorAll('#stage .desk[data-id]').length,done:[...document.querySelectorAll('#stage .desk.is-done')].map(d=>d.title)}))()`);
  ctx.win.webContents.session.webRequest.onBeforeRequest(null);
  assert.strictEqual(ns.st, 'undefined', 'safetext.js was blocked');
  assert.ok(ns.desks >= 15 && ns.done.length > 0 && ns.fin > 0, `no safetext.js: the office draws and done desks read "Finished.": ${JSON.stringify({ d: ns.desks, done: ns.done.slice(0, 2), fin: ns.fin })}`);
  await scan('nosafetext', 'safetext.js missing');

  console.log('[done-desk-mask] all checks passed');
};
