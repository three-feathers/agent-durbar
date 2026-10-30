/* Notes in the window (spec 083, issue 699), pure helpers: which notes a drawer lists and in what order (FR-021), what a row shows
   (every field masked with DurbarSafeText, failing closed, FR-005/FR-022), where inserted text goes in the message box (FR-024), the
   digest input both sides share (FR-009), the entries of the "/" list (FR-030) and the tab switch (FR-025). No DOM, no bridge call:
   app.js draws and talks to main. In the page: window.DurbarNotes; in Node (test-notes): module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarNotes=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const newest=(a,b)=>(a.createdAt<b.createdAt?1:a.createdAt>b.createdAt?-1:a.id<b.id?1:-1);
  const live=notes=>(Array.isArray(notes)?notes:[]).filter(n=>n&&typeof n.id==='string'&&n.done!==true);

  /* FR-021: "This session" (notes whose source.session is this chat's session), then "This folder" (the others); each newest first;
     done notes are in neither group (FR-045). */
  function groups(notes,session){
    const own=[],other=[];
    for(const n of live(notes)){(session&&n.source&&n.source.session===session?own:other).push(n);}
    return {session:own.sort(newest),folder:other.sort(newest)};
  }
  /* the rows in the order the drawer shows them (the roving tabindex follows it) */
  const flat=(notes,session)=>{const g=groups(notes,session);return g.session.concat(g.folder);};

  const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  /* "24 Oct 10:12" in local time (FR-022) */
  function when(iso){
    const d=new Date(iso); if(isNaN(d.getTime()))return '';
    return d.getDate()+' '+MONTHS[d.getMonth()]+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }
  /* where a note came from (FR-022): You, the agent's name, Selection, Typed, From the project file; Changed in the project file when edited there */
  function fromLabel(n,agentName){
    if(!n)return '';
    if(n.from==='file')return 'From the project file';
    if(n.fileEdited)return 'Changed in the project file';
    if(n.from==='selection')return 'Selection';
    if(n.from==='typed')return 'Typed';
    if(n.from==='user')return 'You';
    return String(agentName||'The agent');
  }

  /* One row of the drawer (FR-022), masked: `safe` is DurbarSafeText's wrapper (mask, excerpt). A missing mask gives empty fields,
     never the raw text (fail closed). Nothing here is HTML: the page sets these with textContent or escapes them. */
  function rowView(n,safe,agentName){
    const m=t=>{if(t==null||t==='')return '';if(!safe||typeof safe.mask!=='function')return '';try{const r=safe.mask(String(t));return typeof r==='string'?r:'';}catch(e){return '';}};
    const ex=t=>{if(t==null||t==='')return '';if(!safe||typeof safe.excerpt!=='function')return '';try{const r=safe.excerpt(String(t),200,'');return typeof r==='string'?r:'';}catch(e){return '';}};
    return {id:n.id,rev:n.rev,title:m(n.title),excerpt:ex(n.text),when:when(n.createdAt),from:fromLabel(n,agentName),hidden:n.hidden===true,fromFile:n.from==='file',done:n.done===true};
  }

  /* FR-024: the text goes into the box at the caret; a blank line goes first only when the box has text and the caret is not at a
     line start. Returns the new value and the caret right after the inserted text. */
  function insertInto(value,caret,text){
    const v=String(value==null?'':value), t=String(text==null?'':text);
    const c=Math.max(0,Math.min(caret==null?v.length:Number(caret)||0,v.length));
    let before=v.slice(0,c);
    const after=v.slice(c);
    if(v.trim()!==''&&c>0&&before[c-1]!=='\n'){let e=before.length;while(e>0&&(before[e-1]===' '||before[e-1]==='\t'))e--;before=before.slice(0,e)+'\n\n';} /* a loop, not /[ \t]+$/: that regex retries at every blank of a long run (quadratic) */
    const value2=before+t+after;
    return {value:value2,caret:before.length+t.length};
  }
  /* the "/word" from `start` to `end` is replaced by the text (FR-030), with the same blank-line rule */
  function replaceWord(value,start,end,text){
    const v=String(value==null?'':value), s=Math.max(0,Math.min(Number(start)||0,v.length)), e=Math.max(s,Math.min(Number(end)||0,v.length));
    const r=insertInto(v.slice(0,s)+v.slice(e),s,text);
    return r;
  }

  /* FR-009: the text a message's digest is computed from, on both sides (main's rawDigestInput): line ends unified, ends trimmed */
  const digestInput=raw=>String(raw==null?'':raw).replace(/\r\n/g,'\n').trim();
  /* the first 16 hex characters of SHA-256 of digestInput(raw); `subtle` is crypto.subtle (the page) or a Node webcrypto one */
  async function digestOf(raw,subtle){
    const buf=await subtle.digest('SHA-256',new TextEncoder().encode(digestInput(raw)));
    return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);
  }
  /* the saved note of a message, by session, role and digest (FR-011) */
  function findSaved(notes,session,role,digest){
    if(!session||!digest)return null;
    return (Array.isArray(notes)?notes:[]).find(n=>n&&n.source&&n.source.session===session&&n.source.role===role&&n.source.digest===digest)||null;
  }

  /* FR-030/FR-031: the notes as entries of the "/" list. `source: 'note'` and an `insertText` (spec 073 FR-066): picking one inserts
     that text instead of "/name". The name is the title and the description its first 200 characters; the list masks both again
     (slashsuggest.js view). Done notes are left out; this session's first, then the folder's. */
  const SLASH_NOTES_MAX=5;
  function slashEntries(notes,session){
    const g=groups(notes,session), out=[];
    const mk=(n,scope)=>({name:String(n.title||''),description:String(n.text||'').slice(0,200),source:'note',kind:'note',scope,id:n.id,insertText:String(n.text||''),hidden:n.hidden===true,fromFile:n.from==='file'});
    for(const n of g.session)out.push(mk(n,n.from==='file'?'file':'session'));
    for(const n of g.folder)out.push(mk(n,n.from==='file'?'file':'folder'));
    return out;
  }
  const SCOPE_WORD={session:'this session',folder:'this folder',file:'project file'};

  /* FR-025: opening Notes while the Browser tab is selected selects Chat first. `bp` is the browser pane (current, select). */
  async function showChatTab(bp){
    const c=bp&&typeof bp.current==='function'?bp.current():null;
    if(c&&c.tab==='browser'&&typeof bp.select==='function'){await bp.select('chat');return true;}
    return false;
  }

  /* FR-024: what the notice above the message box says after a note is inserted (from the box or the "/" list); '' = no notice */
  function noticeText(n){
    const parts=[];
    if(n&&n.hidden)parts.push('Parts of this note were hidden when it was saved');
    if(n&&n.from==='file')parts.push('From the project file');
    return parts.join('. ');
  }

  /* FR-040: how many notes the header count shows (not done), and the tooltip: "M from this session, N in this folder" */
  function countOf(notes,session){const g=groups(notes,session);return {total:g.session.length+g.folder.length,session:g.session.length};}
  function countTip(c){return c.session+' from this session, '+c.total+' in this folder';}

  /* FR-041: the note a message is saved as. Same session, role and digest; when the chat has several messages with that digest, `ord`
     tells them apart (only the message at the note's own place carries the marker); a digest that is unique in the chat matches whatever the
     place (a replayed history can number its messages differently). Done notes still mark their message. */
  function markerFor(notes,session,role,digest,ord,sameCount){
    if(!session||!digest)return null;
    const c=(Array.isArray(notes)?notes:[]).filter(n=>n&&n.source&&n.source.session===session&&n.source.role===role&&n.source.digest===digest);
    if(!c.length)return null;
    if(sameCount>1)return c.find(n=>n.source.ord===ord)||null;
    return c[0];
  }

  /* FR-043: the drawer's search. Both groups are filtered the same way: the notes whose (masked) title ranks for the query, in rank order
     (`rank` is DurbarNav.rank, as the "/" list uses it), then the others whose masked text holds every word, case-insensitive, in their own
     order. `mask` is DurbarSafeText.mask (fail closed: a field that cannot be masked never matches). An empty query keeps everything. */
  function search(g,query,rank,mask){
    const q=String(query==null?'':query).trim();
    if(!q)return g;
    const words=q.toLowerCase().split(/\s+/).filter(Boolean);
    const m=t=>{if(t==null||t==='')return '';if(typeof mask!=='function')return '';try{const r=mask(String(t));return typeof r==='string'?r:'';}catch(e){return '';}};
    const one=list=>{
      const items=list.map(n=>({label:m(n.title),kw:'',n}));
      const byTitle=typeof rank==='function'?rank(items,q).map(x=>x.n):[];
      const seen=new Set(byTitle);
      const byText=list.filter(n=>{if(seen.has(n))return false;const t=m(n.text).toLowerCase();return words.every(w=>t.includes(w));});
      return byTitle.concat(byText);
    };
    return {session:one(g.session),folder:one(g.folder)};
  }
  /* the no-match line names the words, masked and cut (the query is typed or pasted, so it can hold a secret) */
  function noMatch(query,mask){
    let t='';try{const r=typeof mask==='function'?mask(String(query==null?'':query).trim()):'';t=typeof r==='string'?r:'';}catch(e){t='';}
    if(t.length>60)t=t.slice(0,60)+'…';
    return t?'No notes match "'+t+'"':'No notes match';
  }

  /* FR-042: the selected text as it is saved: line ends unified, the ends trimmed, no zero-width marks; '' when nothing is left */
  function selectionText(raw){return String(raw==null?'':raw).replace(/\r\n?/g,'\n').replace(/[\u200b-\u200d\ufeff]/g,'').trim();}
  /* FR-042: where the floating "Save to notes" button goes: just below the end of the selection; when that would cover the avoided box
     (the composer, the answer bar) it goes above the selection's start instead; always inside `view` (the visible chat log). When
     neither place keeps it clear of the avoided box (the selection is out of the log), null: no button. Rects are {top,bottom}. */
  function selButtonTop(sel,h,view,avoid){
    const gap=6, clash=t=>!!avoid&&t+h>avoid.top&&t<avoid.bottom;
    let top=sel.endBottom+gap;
    if(clash(top))top=sel.startTop-h-gap;
    top=Math.max(view.top+8,Math.min(top,view.bottom-h-8));
    return clash(top)?null:top;
  }

  return {selectionText,selButtonTop,groups,flat,countOf,countTip,markerFor,search,noMatch,noticeText,when,fromLabel,rowView,insertInto,replaceWord,digestInput,digestOf,findSaved,slashEntries,SLASH_NOTES_MAX,SCOPE_WORD,showChatTab};
})());
