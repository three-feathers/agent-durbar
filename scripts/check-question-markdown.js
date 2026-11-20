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
 *   1. app.js qMdHTML: render the unmasked text and drop the checks (`const r=RED?RED.redact(s):null;` -> `const r=s;`, `const same=v=>safeMask(v)===v` -> `const same=v=>true`, drop `if(!qRunsIn(shown,m))return plain();`)  => "the token is in no text of the card"
 *   2. app.js showQuestion: `qb.innerHTML=qMdHTML(q.question)` -> `qb.textContent=q.question` => "the bold is a <strong>"
 *   3. styles.css `.note.question .q-text .q-md{overflow-wrap:anywhere}` plus `overflow:hidden;max-height:3em`  => "nothing is cut"
 *   4. app.js qMdHTML: decide by a count of masks again (`const same=v=>safeMask(v)===v` -> `const same=()=>(c=>c(safeMask(s))<=c(r))(t=>(t.match(/\[redacted\]/g)||[]).length)`, and drop `if(!qRunsIn(shown,m))return plain();`)  => "split value"
 *   5. app.js qMdHTML: check only the shown text, not the attributes (`for(const e of els)for(const at` -> `for(const e of [])for(const at`)  => "link address"
 *   6. app.js qMdHTML: the fallback shows the raw question (`plain=()=>'<p>'+esc(m)+'</p>'` -> `plain=()=>'<p>'+esc(String(raw))+'</p>'`)  => "definition only"
 *   7. app.js qMdHTML: render images again (`||/!\[/.test(s)||qRefsLeft(s))` -> `||qRefsLeft(s))`)  => "an image"
 *   8. app.js qMdHTML: drop the cross-check with the raw reading (`if(!qRunsIn(shown,m))return plain();` -> ``)  => "short tail"
 *   9. app.js qRef: drop the C1 branch (`if(cp>=0x80&&cp<=0x9f)return all;` -> ``)  => "a number HTML reads as another character"
 *  10. app.js qMdHTML: no masking of reference runs (`const s=qMaskRefRuns(s0);` -> `const s=s0;`)  => "unknown reference between value pieces"
 *  11. app.js qRefsLeft: any `&` before a letter is a leftover (`/&(?:[A-Za-z][A-Za-z0-9]{0,31};|` -> `/&(?:[A-Za-z]|`)  => "a bare ampersand is ordinary text"
 *  12. app.js Q_NAMED: drop the names beyond the basic ones (`colon:':',` and `mdash:'\u2014',` removed)  => "known named references keep the Markdown"
 * Named references are checked against the browser's own reading (a textarea in the test page), never against the card's decoder.
 * Edge questions (review of PR 1933), built from invented pieces and rendered through the card's own qMdHTML (the simulator's bridge): a question
 * made only of a definition, a value split late, a literal mask word as link text, character references, a link address, a link title, character references in every form (and ones nested past the limit or unknown), images
 * (a value's head as alt text with the rest after it, an image then a link, two images; a plain image), a value split late with a short tail. Each must
 * give no readable piece of the value in its text or attributes.
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
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
      await js(`window.__durbarSimUi.crew.openPanel(${jsLiteral(id)})`);
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
    const edge = await js(`(()=>{const p='gh'+'p_',b='A1b2C3d4E5f6G7h8I9j0',t='K1l2M3n4O5p6Q7r8',v=p+b+t,ref=[...v].map(c=>'&#'+c.charCodeAt(0)+';').join(''),pct=[...v].map(c=>'%'+c.charCodeAt(0).toString(16)).join('');
      const qs={def:'[x]: https://example.com/'+v,split:'one '+v+' and '+p+b+'**'+t+'**',word:'[[redacted]](https://example.com/x) '+v+' and '+p+b+'*'+t+'*',
        refs:'see '+ref+' and '+ref.replace(/&/g,'&amp;'),
        refs2:'**see** '+[...v].map(c=>'&#X'+c.charCodeAt(0).toString(16).toUpperCase()+';').join('')+' and '+[...v].map(c=>'&#0000'+c.charCodeAt(0)).join(' ').replace(/ /g,'')+' and '+v.slice(0,12)+'&ZeroWidthSpace;'+v.slice(12),
        deep:'**see** '+v.slice(0,10)+'&'+'amp;'.repeat(8)+'#'+v.charCodeAt(10)+';'+v.slice(11),near:'**see** '+v.slice(0,12)+'&zerowidthspace;'+v.slice(12)+' and '+'&ZeroWidthSpac;'+' and R&D',
        img:'see !['+v.slice(0,12)+'](https://example.com/a.png)'+v.slice(12),imgLink:'see !['+v.slice(0,12)+'](https://example.com/a.png)['+v.slice(12)+'](https://example.com/b)',
        img2:'![x](https://example.com/a.png)!['+v.slice(0,25)+'](https://example.com/b.png)'+v.slice(25),pic:'Look at ![a picture](https://example.com/p.png) first.',tail:'one '+v.slice(0,34)+'*'+v.slice(34)+'*',href:'Read [the notes](https://example.com/'+pct+').',title:'Read [the notes](https://example.com/notes "'+ref+'").'};
      const out={};for(const k in qs){const d=document.createElement('template');d.innerHTML=window.__durbarSimUi.qMdHTML(qs[k]);const x=d.content.textContent,at=[...d.content.querySelectorAll('*')].flatMap(e=>[...e.attributes].map(a=>a.name+'='+a.value));
        out[k]={piece:/A1b2C3d4|E5f6G7h8|I9j0|K1l2M3n4|O5p6Q7r8|p6Q7r8/.test(x+at.join(' ')),masks:(x.match(/\\[redacted\\]/g)||[]).length,strong:!!d.content.querySelector('strong,em'),
          href:at.some(a=>/^href=.*%41%31/i.test(a)),title:at.some(a=>a.startsWith('title=')),stand:x.includes('[image'),fixed:x.startsWith('This question cannot be shown safely.'),empty:!x.trim()};}return out;})()`);
    const E = (k) => JSON.stringify(edge[k]);
    assert.ok(!edge.def.piece && !edge.def.empty && edge.def.masks === 1, `${tag}: definition only: the card shows masked text, never the raw question: ${E('def')}`);
    assert.ok(!edge.split.piece && edge.split.masks === 2 && !edge.split.strong, `${tag}: split value: a value split late falls back to masked plain text: ${E('split')}`);
    assert.ok(!edge.word.piece && !edge.word.strong, `${tag}: a mask word written as link text does not let a value through: ${E('word')}`);
    assert.ok(!edge.refs.piece && edge.refs.masks === 2, `${tag}: character references are read before both masks: ${E('refs')}`);
    assert.ok(!edge.refs2.piece && edge.refs2.masks === 3, `${tag}: character references in any form (hex in capitals, leading zeros, no semicolon, a hidden-character name) are read before both masks: ${E('refs2')}`);
    assert.ok(!edge.deep.piece && !edge.deep.strong && edge.deep.fixed, `${tag}: references nested past the limit show the fixed sentence: ${E('deep')}`);
    assert.ok(!edge.near.piece && !edge.near.strong && !edge.near.empty, `${tag}: a reference the card does not know falls back to masked plain text: ${E('near')}`);
    assert.ok(!edge.href.href, `${tag}: link address: a link whose address holds a value is not rendered: ${E('href')}`);
    assert.ok(!edge.title.piece && !edge.title.title, `${tag}: a link keeps no title: ${E('title')}`);
    const refs = await js(`(()=>{const U=window.__durbarSimUi,v='gh'+'p_'+'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',ch=v.slice(4).match(/.{4}/g);
      const tx=h=>{const d=document.createElement('template');d.innerHTML=h;return d.content;};
      const ta=document.createElement('textarea'),bdec=t=>{let x=t;for(let i=0;i<9;i++){ta.innerHTML=x;if(ta.value===x)break;x=ta.value;}return x;}; /* the browser's own reading, as the baseline */
      const names=['lowbar','UnderBar','equals','period','colon','sol','commat','percnt','ast','midast','grave','DiacriticalGrave','Hat','hyphen','dash','minus','dollar','plus','num','excl','quest','bsol','verbar'];
      const more=[];for(const nm of names)for(const ref of ['&'+nm+';','&amp;'+nm+';','&ZeroWidthSpace;&'+nm+';','&'+nm])for(const at of [3,4,12,20]){
        const q='**see** '+v.slice(0,at)+ref+v.slice(at)+' ok',card=tx(U.qMdHTML(q)).textContent,base=U.qSafeMask(bdec(q));if(ch.some(c=>card.includes(c)&&!base.includes(c)))more.push(nm+'|'+ref+'|'+at);}
      const bad=U.qNames().filter(e=>{const i=e.indexOf('=');return bdec('&'+e.slice(0,i)+';')!==e.slice(i+1);});
      const md=q=>{const c=tx(U.qMdHTML(q));return !!c.querySelector('strong');};
      const bare=['**R&D** plan?','**AT&T** or **A&B**?','Eat **M&Ms**?','Edit \x60a&b.ts\x60 **now**?','See [the page](https://example.com/x?a=1&b=2) **first**?'].filter(q=>!md(q));
      const link=!!tx(U.qMdHTML('See [the page](https://example.com/x?a=1&b=2) **first**?')).querySelector('a[href="https://example.com/x?a=1&b=2"]');
      const named=['**Copyright** &copy; 2026 &mdash; ok?','**a** &colon; b &lowbar; c &ndash; d &hellip; e &equals; f'].filter(q=>!md(q));
      const unk=tx(U.qMdHTML('**see** '+v.slice(0,12)+'&zzunknownzz;'+v.slice(12))).textContent;
      return {more,bad,bare,link,named,unk:{text:unk,piece:ch.some(c=>unk.includes(c)),ref:unk.includes('&zz')},c1:md('**see** &#150; here')};})()`);
    assert.deepStrictEqual(refs.bad, [], `${tag}: every name in the card's reference table reads as the browser reads it`);
    assert.deepStrictEqual(refs.more, [], `${tag}: named references inside a value (plain, double-encoded, after a hidden character, without a semicolon) show nothing that masking the raw text hides`);
    assert.ok(!refs.unk.piece && !refs.unk.ref, `${tag}: unknown reference between value pieces: the run is masked: ${JSON.stringify(refs.unk)}`);
    assert.ok(!refs.c1, `${tag}: a number HTML reads as another character falls back to masked plain text`);
    assert.ok(refs.bare.length === 0 && refs.link, `${tag}: a bare ampersand is ordinary text: these keep their Markdown and link: ${JSON.stringify(refs)}`);
    assert.deepStrictEqual(refs.named, [], `${tag}: known named references keep the Markdown`);
    for (const k of ['img', 'imgLink', 'img2']) assert.ok(!edge[k].piece && !edge[k].stand && !edge[k].empty, `${tag}: an image question (${k}) shows masked plain text with no piece of the value: ${E(k)}`);
    assert.ok(!edge.pic.stand && !edge.pic.empty, `${tag}: an image: a question with an image shows plain text, never the image stand-in: ${E('pic')}`);
    assert.ok(!edge.tail.piece && edge.tail.masks === 1 && !edge.tail.strong, `${tag}: short tail: a value split late with a short tail falls back to masked plain text: ${E('tail')}`);
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
