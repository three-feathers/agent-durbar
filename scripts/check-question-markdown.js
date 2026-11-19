/*
 * Check for spec 052 (2026-11-19 delta, issue #1927, T378): the agent's question card renders the question text's Markdown with the chat's own
 * safe renderer (DurbarMD), after the text is masked. Simulator only (no AI credits).
 *
 *   npm run check:ui -- --only check-question-markdown
 *   OUT=docs/screenshots  (optional) also saves the screenshots
 *
 * `simquestion=markdown` asks a question with bold, a numbered list, a code span, an arrow, a link, a raw `<b>` tag and an invented token
 * (built from pieces). At 1440x900 and 1280x800, with 15 agents, in the flat office, the Real office and the arcade: the card shows a
 * <strong>, an <ol> of three items, a <code>, a link with its href (never followed: no navigation) and no `**`; the raw tag is text, never an
 * element; the token is in no text, title or label of the card (masked before it is rendered); the card keeps its group name
 * "Question from the agent", the options are in a radiogroup named without Markdown marks, the "Other answer" box keeps its placeholder
 * and its label; every text in the question is at least 10.5px; nothing is cut (no ellipsis, line clamp or hidden overflow) and the card
 * stays inside the chat without a sideways scroll. Mutants (source edits, run by hand; each dies at its own assert):
 *   1. app.js qMdHTML: render the unmasked text and drop the fail-closed fallback (`const r=RED?RED.redact(s):null;` -> `const r=s;`, `n(plain)>n(r)` -> `false`)  => "the token is in no text of the card"
 *   2. app.js showQuestion: `qb.innerHTML=qMdHTML(q.question)` -> `qb.textContent=q.question` => "the bold is a <strong>"
 *   3. styles.css `.note.question .q-text .q-md{overflow-wrap:anywhere}` plus `overflow:hidden;max-height:3em`  => "nothing is cut"
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const path = require('path');
const { helpers } = require('./driver-helpers');
const assert = require('assert');
const OUT = process.env.OUT || require('os').tmpdir();
const WORLDS = (process.env.QMD_WORLDS || 'flat,real,retro').split(',');
module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  for (const world of WORLDS) for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${world} ${w}x${h}`;
    const query = { sim: '15', simquestion: 'markdown', ...(world === 'flat' ? {} : { officeview: 'real' }), ...(world === 'retro' ? { worldflags: 'retro', world: 'retro' } : {}) };
    await H.load({ w, h, query, ready: 'fit' });
    let o;
    if (world === 'flat') o = await H.openSimAgent(`a=>!a.parent&&a.question`, '#chat .note.question .q-opt');
    else { // the Real office and the arcade have no desks: open the asking agent's chat as check-097-chat-contrast does
      const id = await H.until(`((window.__durbarSimUi&&window.__durbarSimUi.agents().find(a=>!a.parent&&a.question))||{}).id`, 20000) && await js(`window.__durbarSimUi.agents().find(a=>!a.parent&&a.question).id`);
      await js(`window.__durbarSimUi.crew.openPanel(${JSON.stringify(id)})`);
      o = { id, ok: await H.until(`document.body.classList.contains('panel-open')&&!!document.querySelector('#chat .note.question .q-opt')`, 15000), seen: {} };
    }
    assert.ok(o.ok, `${tag}: an agent has the question in its chat: ${JSON.stringify({ id: o.id, ...o.seen })}`);
    await settle();
    await js(`document.querySelector('#chat .note.question').scrollIntoView({block:'center'})`); await settle();
    const r = await js(`(()=>{const card=document.querySelector('#chat .note.question'),q=card.querySelector('.q-text'),md=q.querySelector('.q-md'),chat=document.getElementById('chat');
      const all=[card.innerHTML,card.textContent,...[...card.querySelectorAll('[title],[aria-label],[placeholder]')].map(e=>(e.title||'')+(e.getAttribute('aria-label')||'')+(e.getAttribute('placeholder')||''))].join('\\n');
      const els=[q,...q.querySelectorAll('*')];
      const small=els.filter(e=>parseFloat(getComputedStyle(e).fontSize)<10.5).map(e=>e.tagName+':'+getComputedStyle(e).fontSize);
      const cut=els.filter(e=>{const c=getComputedStyle(e);return e.scrollHeight>e.clientHeight+1&&e.tagName!=='CODE'&&c.overflowY!=='visible'||c.textOverflow==='ellipsis'||(c.webkitLineClamp&&c.webkitLineClamp!=='none');}).map(e=>e.tagName);
      const cr=card.getBoundingClientRect(),hr=chat.getBoundingClientRect(),a=md.querySelector('a');
      const og=card.querySelector('.q-opts'),ob=card.querySelector('.q-other');
      return {strong:[...md.querySelectorAll('strong')].map(x=>x.textContent),ol:md.querySelectorAll('ol>li').length,code:[...md.querySelectorAll('code')].map(x=>x.textContent),
        href:a&&a.getAttribute('href'),linkText:a&&a.textContent,stars:q.textContent.includes('**'),rawB:!!md.querySelector('b'),rawBText:md.textContent.includes('<b>not bold</b>'),
        leak:/ghp_|A1b2C3d4|E5f6G7h8/.test(all),masked:/\\*|hidden|redact/i.test(md.textContent),small,cut,
        group:card.getAttribute('role')+'|'+card.getAttribute('aria-label'),radio:og.getAttribute('role')+'|'+og.getAttribute('aria-label'),
        ph:ob.placeholder,oLabel:ob.getAttribute('aria-label'),opts:[...card.querySelectorAll('.q-opt')].map(b=>b.textContent+':'+b.tabIndex+':'+b.disabled),
        inside:cr.left>=hr.left-1&&cr.right<=hr.right+1,sideways:chat.scrollWidth>chat.clientWidth+1,h:Math.round(cr.height),url:location.href,text:md.textContent.slice(0,120),html:md.innerHTML.slice(0,300)}})()`);
    assert.deepStrictEqual(r.strong.slice(0, 2), ['Which plan should I follow?', 'Small:'], `${tag}: the bold is a <strong>: ${r.html}`);
    assert.strictEqual(r.ol, 3, `${tag}: the numbered points are a list of three: ${JSON.stringify(r)}`);
    assert.ok(r.code.includes('settings.ts'), `${tag}: the code span is a <code>: ${JSON.stringify(r.code)}`);
    assert.ok(r.href === 'https://example.com/notes' && r.linkText === 'the notes', `${tag}: the link is a link with its address: ${JSON.stringify(r)}`);
    assert.ok(!r.stars, `${tag}: no raw ** is shown: ${r.text}`);
    assert.ok(!r.rawB && r.rawBText, `${tag}: a raw <b> tag is shown as text, never parsed: ${JSON.stringify(r)}`);
    assert.ok(!r.leak, `${tag}: the token is in no text of the card (masked before it is rendered)`);
    assert.deepStrictEqual(r.small, [], `${tag}: every text of the question is at least 10.5px`);
    assert.deepStrictEqual(r.cut, [], `${tag}: nothing is cut (no ellipsis, line clamp or hidden overflow)`);
    assert.strictEqual(r.group, 'group|Question from the agent', `${tag}: the card keeps its group name`);
    assert.ok(/^radiogroup\|Which plan should I follow\? /.test(r.radio) && !/[*`]/.test(r.radio), `${tag}: the options' group is named in plain words: ${r.radio}`);
    assert.strictEqual(r.ph, 'Other answer (Enter to send)', `${tag}: the Other answer box keeps its placeholder`);
    assert.ok(/^Other answer: Which plan/.test(r.oLabel) && !/\*/.test(r.oLabel), `${tag}: the Other answer box is labelled in plain words: ${r.oLabel}`);
    assert.deepStrictEqual(r.opts, ['Small:0:false', 'Large:0:false'], `${tag}: the options are reachable and on`);
    assert.ok(r.inside && !r.sideways, `${tag}: the card is inside the chat with no sideways scroll: ${JSON.stringify(r)}`);
    await H.shot(path.join(OUT, `052-question-markdown-${world}-${w}x${h}.png`), { prep: 'mouse', tag: 'question-markdown' });
  }
  console.log('[question-markdown] all checks passed');
};
