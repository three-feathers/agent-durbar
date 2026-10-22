/*
 * Check for spec 041 FR-065 (issue #541): text an agent wrote never reaches the office floor unmasked. Simulator only (no AI credits).
 *
 *   npm run check:done-desk-mask
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
const NEEDLES = [GHP, PAT, SK, KEY, GHP.replace(/_/g, ''), PAT.replace(/_/g, ''), 'A1b2C3d4', '11ABCDEFG0', 'proj-AbCdEf', 'projAbCdEf', 'Kd93LmP', 'ghp', 'github_pat', 'githubpat'].map((x) => x.toLowerCase());
const SCAN = `(()=>{const out=[];const skip=e=>!!e.closest('#chat');
  const w=document.createTreeWalker(document.documentElement,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
  for(let n=w.currentNode;n;n=w.nextNode()){
    if(n.nodeType===3){const p=n.parentElement;if(p&&!skip(p)&&!/^(SCRIPT|STYLE)$/.test(p.tagName))out.push(n.nodeValue);}
    else if(!skip(n))for(const at of n.attributes)out.push(at.value);}
  const ag=(window.__durbarSimUi&&window.__durbarSimUi.agents())||[];
  for(const a of ag)out.push(String(a.task||''));
  return out.join('\\n').toLowerCase();})()`;
module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const scan = async (tag, what) => {
    const page = await js(SCAN);
    for (const nd of NEEDLES) assert.ok(!page.includes(nd), `${tag}: "${nd.slice(0, 10)}..." is on the page (${what}): ...${page.slice(Math.max(0, page.indexOf(nd) - 60), page.indexOf(nd) + 40).replace(/\n/g, ' ')}...`);
  };
  const emit = (ev) => js(`window.__durbarSimUi.emit(${JSON.stringify(ev)})`);
  const back = async () => { await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click();})()`); await until(`!document.body.classList.contains('panel-open')`); };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const level of ['expert', 'simple']) {
      const Q = { simreply: 'secrets' };
      await H.load({ w, h, query: Q, ready: 'fit', settle: false });
      await js(`localStorage.setItem('durbar.detail',${jsLiteral(level)})`);
      await H.load({ query: Q, ready: 'fit' });
      const tag = `${w} ${level}`;
      // 1. desks and helper cards with what the simulator planted
      const seen = await js(`(()=>{const done=[...document.querySelectorAll('#stage .desk.is-done')];
        return {n:done.length,masked:done.filter(d=>/Done: Done\\. Token check: \\[redacted\\]/.test(d.title)||/Done\\. Token check: \\[redacted\\]/.test(d.getAttribute('aria-label')||'')).length,helpers:document.querySelectorAll('#stage .helper').length,open:document.body.classList.contains('panel-open')};})()`);
      assert.ok(seen.n > 0 && seen.masked > 0 && !seen.open, `${tag}: done desks show the masked reply: ${JSON.stringify(seen)}`);
      assert.ok(seen.helpers > 0, `${tag}: helper cards are on the floor`);
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
      await emit({ type: 'status', sessionId: m3, timestamp: ts, status: 'error', intent: 'Failed with ' + GHP + ' and ' + PAT + ' and ' + SK });
      await scan(tag, 'error intent');
      // 3. a question with the tokens: the Needs you inbox and the answer bar
      await emit({ type: 'question', sessionId: m2, timestamp: ts, phase: 'asked', requestId: 'q-secret', questions: [{ question: 'Shall I keep ' + GHP + ' and ' + PAT + ' and ' + SK + ' in the file?', header: 'Secrets', multiSelect: false, options: [{ label: 'Yes' }, { label: 'No' }] }] });
      await until(`!!document.querySelector('#stage .desk.is-waiting,#stage .desk[data-id=${JSON.stringify(m2)}]')`);
      await js(`document.getElementById('inboxBtn').click()`);
      await until(`document.querySelectorAll('.ib-t').length>0`);
      assert.ok(await js(`[...document.querySelectorAll('.ib-t')].some(e=>/\\[redacted\\]/.test(e.textContent))`), `${tag}: the inbox shows the question, masked`);
      await scan(tag, 'Needs you inbox');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      await js(`(()=>{const d=document.querySelector('#stage .desk[data-id='+JSON.stringify(${jsLiteral(m3)})+']');if(d)d.click();})()`);
      await until(`document.body.classList.contains('panel-open')`);
      await until(`!!document.getElementById('answerBar')&&!document.getElementById('answerBar').hidden&&/\\[redacted\\]/.test(document.getElementById('answerBar').textContent)`);
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
      assert.ok(await js(`[...document.querySelectorAll('#prevLists .prev-t')].some(e=>/\\[redacted\\]/.test(e.textContent))`), `${tag}: a previous session title shows masked`);
      await scan(tag, 'previous-sessions list');
      await js(`document.querySelector('#prevLists [data-pv="resume"]').click()`);
      await until(`window.__durbarSimUi.agents().some(a=>/^Resumed: /.test(a.task||''))`);
      await back();
      await scan(tag, 'resumed session');
    }
  }
  // 6. a restored session continued (simresume=1)
  await H.load({ w: 1440, h: 900, query: { simreply: 'secrets', simresume: '1' }, ready: 'fit' });
  const r = await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.info&&x.info.resumeLast);return a?a.id:''})()`);
  assert.ok(r, 'an agent with a session to continue');
  await js(`document.querySelector('#stage .desk[data-id='+JSON.stringify(${jsLiteral(r)})+']').click()`);
  await until(`window.__durbarSimUi.agents().some(a=>/^Continued: /.test(a.task||''))`);
  await back();
  await scan('continued', 'continued session');
  // 7. no redact module: fail closed, Durbar's own words stay
  await H.load({ w: 1440, h: 900, query: { simreply: 'secrets', noredact: '1' }, ready: 'fit' });
  const nr = await js(`(()=>({done:[...document.querySelectorAll('#stage .desk.is-done')].map(d=>d.title),page:document.body.innerText}))()`);
  assert.ok(nr.done.length > 0 && nr.done.every((t) => /Done: Finished\./.test(t)), `noredact: done desks read "Finished.": ${JSON.stringify(nr.done.slice(0, 2))}`);
  assert.ok(/Thinking/.test(nr.page), 'noredact: Durbar\'s own "Thinking" stays');
  await scan('noredact', 'no redact module');
  console.log('[done-desk-mask] all checks passed');
};
