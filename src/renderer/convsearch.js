/* Spec 095 phase 3 (T030, T034, T042, T043): the pure part of the conversation search window: no DOM, no I/O. The results kept per
   group, the excerpt and title HTML (marks from main's offsets, text through esc(), never raw HTML), the state and end-state lines, the
   accessible names, the re-sort at the end that keeps a row in place, and the pick of the message to jump to. In the page:
   window.DurbarConvSearch; in Node: module.exports (scripts/test-convsearchui.ts). */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarConvSearch=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const SPEAKER={you:'You:',agent:'Agent:'};
  /* a row's key; it goes into an HTML attribute, so no control character (the parser turns NUL into U+FFFD) */
  const keyOf=h=>[h&&h.group,h&&h.adapter,h&&h.sessionId].map(x=>encodeURIComponent(String(x))).join(':');
  /* a hit's "+N more" comes from main and goes into the page: always a whole number of 0 or more, never text */
  const moreOf=h=>Math.max(0,Number(h&&h.more)|0);
  const plural=(n,one,many)=>n+' '+(n===1?one:(many||one+'s'));
  const listWords=a=>a.length<2?a.join(''):a.slice(0,-1).join(', ')+' and '+a[a.length-1];

  /* FR-033 (Q3): the window's own copy of the minimum, counted as main does (code points, spaces not counted); main decides */
  const longEnough=q=>[...String(q==null?'':q).replace(/\s+/g,'')].length>=3;

  /* the results of one search: hits by key, the arrival order per group (FR-015: rows already shown do not move while it scans) */
  function create(){return {hits:new Map(),order:{office:[],earlier:[]},progress:{done:0,total:0},done:false,notes:null,stopped:false,failed:false,userStop:false,queryCut:false};}
  /* a batch (FR-020): new hits are appended in the order they came (per folder, newest first inside it); a hit seen again replaces its data in place */
  function addBatch(st,b){
    for(const h of (b&&Array.isArray(b.hits)?b.hits:[])){
      if(!h||(h.group!=='office'&&h.group!=='earlier'))continue;
      const k=keyOf(h);
      if(!st.hits.has(k))st.order[h.group].push(k);
      st.hits.set(k,h);
    }
    if(b&&b.progress)st.progress={done:+b.progress.done||0,total:+b.progress.total||0};
    return st;
  }
  /* search:done: each group newest first (FR-010; the office group by `timeOf`, since main does not know when an open session was last
     active). Pinned earlier sessions are not moved up (Q8). `keep` (a key) is the row under the pointer or with focus: it is the caller's
     job to keep it on screen; the order of the others is the new one. */
  function finish(st,d,timeOf){
    st.done=true; st.notes=d&&d.notes||null; st.stopped=!!(d&&d.stopped); st.failed=!!(d&&d.failed);
    if(d&&d.progress)st.progress={done:+d.progress.done||0,total:+d.progress.total||0};
    resort(st,timeOf);
    return st;
  }
  function resort(st,timeOf){
    const t=k=>{const h=st.hits.get(k);const v=typeof timeOf==='function'?timeOf(h):h&&h.time;return typeof v==='number'&&isFinite(v)?v:0;};
    for(const g of ['office','earlier']){const idx=new Map(st.order[g].map((k,i)=>[k,i]));st.order[g]=st.order[g].slice().sort((a,b)=>t(b)-t(a)||idx.get(a)-idx.get(b));}
    return st;
  }
  /* sort headers (FR-004): by name, app, folder or when; ascending or descending, inside each group; null = the search's own order */
  function sorted(st,sort,timeOf){
    const out={office:st.order.office.map(k=>st.hits.get(k)),earlier:st.order.earlier.map(k=>st.hits.get(k))};
    if(!sort)return out;
    const val={name:h=>String(h.title||'').toLowerCase(),app:h=>String(h.app||'').toLowerCase(),folder:h=>String(h.folderName||'').toLowerCase(),ago:h=>-(typeof timeOf==='function'?timeOf(h):h.time||0)}[sort.key];
    if(!val)return out;
    const dir=sort.dir==='desc'?-1:1;
    for(const g of ['office','earlier'])out[g]=out[g].map((h,i)=>({h,i})).sort((a,b)=>{const x=val(a.h),y=val(b.h);return (x<y?-1:x>y?1:0)*dir||a.i-b.i;}).map(x=>x.h);
    return out;
  }
  const count=st=>st.order.office.length+st.order.earlier.length;

  /* text with <mark> on [start, end) ranges (main's offsets, FR-011): every piece through esc(); overlapping or bad ranges are merged or dropped */
  /* review of PR 1240 (Q1): bidi embedding, override and isolate controls (U+202A..U+202E, U+2066..U+2069) are dropped for display, so a
     masked excerpt cannot reorder what is shown; the marks' offsets move with the text */
  const BIDI=/[\u202A-\u202E\u2066-\u2069]/;
  function dropBidi(text,marks){
    const s=String(text==null?'':text); if(!BIDI.test(s))return {s,marks};
    const map=[]; let out='';
    for(let i=0;i<s.length;i++){map.push(out.length);if(!BIDI.test(s[i]))out+=s[i];}
    map.push(out.length);
    const at=i=>map[Math.max(0,Math.min(s.length,+i||0))];
    return {s:out,marks:(Array.isArray(marks)?marks:[]).map(m=>[at(m[0]),at(m[1])])};
  }
  function markedHTML(text,marks0,esc){
    const d=dropBidi(text,marks0), s=d.s, marks=d.marks, r=(Array.isArray(marks)?marks:[]).map(m=>[Math.max(0,Math.min(s.length,+m[0]||0)),Math.max(0,Math.min(s.length,+m[1]||0))]).filter(m=>m[1]>m[0]).sort((a,b)=>a[0]-b[0]);
    const merged=[]; for(const m of r){const l=merged[merged.length-1];if(l&&m[0]<=l[1])l[1]=Math.max(l[1],m[1]);else merged.push(m.slice());}
    let out='',at=0;
    for(const [a,b] of merged){out+=esc(s.slice(at,a))+'<mark>'+esc(s.slice(a,b))+'</mark>';at=b;}
    return out+esc(s.slice(at));
  }
  /* one excerpt line: who said it, then the masked text with its marks */
  function excerptHTML(x,esc){
    const who=SPEAKER[x&&x.speaker]||'';
    return (who?'<span class="cs-who">'+esc(who)+'</span> ':'')+markedHTML(x&&x.text,x&&x.marks,esc);
  }
  /* US3.4: "title, app, folder, open or previous, match: excerpt"; the marks are plain text here (a <mark> carries no extra speech) */
  function accName(h){
    const first=h&&h.excerpts&&h.excerpts[0], where=h&&h.group==='office'?'open':'previous';
    const m=first?(SPEAKER[first.speaker]||'')+' '+String(first.text||''):'match in the title';
    return [h&&h.title||'Untitled session',h&&h.app,h&&h.folderName,where].filter(Boolean).join(', ')+', match: '+m.trim()+(moreOf(h)?', '+plural(moreOf(h),'more match','more matches'):'');
  }

  /* FR-015: the state line while scanning, and the final line (US3.4) */
  function stateText(st){
    if(!st.done)return 'Searching, '+st.progress.done+' of '+plural(st.progress.total,'session');
    const n=count(st);
    if(st.failed&&!n)return 'The search could not finish.';
    if(!n)return 'No conversation matches';
    /* a result is a match: each excerpt and each "+N more", or the title of a title hit; the sessions are the rows */
    let r=0; for(const h of st.hits.values())r+=Math.max(1,(h.excerpts||[]).length+moreOf(h));
    return plural(r,'result')+' in '+plural(n,'session');
  }
  /* FR-014 (and owner answers C, D; review N-R2): one line, only what applies */
  const LOCKED='Some saved MCP values are locked; excerpts may show them.', CUT='Your search was cut to 8 words and 200 characters.';
  function notesText(st){
    const n=st&&st.notes, out=[];
    if(st&&st.userStop)out.push('Stopped.');
    else if(st&&st.stopped)out.push('The search stopped when the window was closed or hidden. Search again to finish it.');
    else if(st&&st.failed&&count(st)>0)out.push('The search could not finish.'); /* review of PR 1240 (R5): with no result the state line says it already */
    if(!n){if(st&&st.queryCut)out.push(CUT);return out.join(' ');} /* R6: a window-side Stop has no notes from main; the window's own note of a cut query stays */
    out.push('Searched '+plural(+n.searched||0,'session')+' in '+plural(+n.folders||0,'folder')+'.');
    const not=[];
    for(const a of n.notInstalled||[])not.push(a+' (not installed or signed out)');
    if(n.titleOnly&&n.titleOnly.count)not.push('earlier '+listWords(n.titleOnly.apps||[])+' sessions, by title only ('+n.titleOnly.count+')');
    if(n.tooLarge)not.push(plural(n.tooLarge,'session')+' too large to search');
    if(n.unreadable)not.push(plural(n.unreadable,'unreadable session'));
    if(n.hidden)not.push(plural(n.hidden,'hidden earlier session'));
    if(n.floorsOff)not.push(plural(n.floorsOff,'session')+' on floors that are off');
    if(n.floorOffFolders)not.push('earlier Codex sessions of '+plural(n.floorOffFolders,'folder')+' on floors that are off');
    if(n.lateLists)not.push('earlier sessions of '+plural(n.lateLists,'folder')+' (no answer in time'+(n.lateApps&&n.lateApps.length?': '+listWords(n.lateApps):'')+')');
    if(n.bounded)not.push(plural(n.bounded,'message')+' too dense to search');
    if(n.maskFailed)not.push(plural(n.maskFailed,'message')+' that could not be masked');
    if(not.length)out.push('Not searched: '+not.join('; ')+'.');
    if(n.cut)out.push(plural(n.cut,'long message')+' searched in '+(n.cut===1?'its':'their')+' first 20 000 characters only.');
    if(n.capped&&n.capped.results)out.push('200 shown; narrow your search.');
    else if(n.capped&&(n.capped.sessions||n.capped.perFolder))out.push('Only the newest sessions were searched (at most 400, 200 earlier ones per folder).');
    if(n.timedOut)out.push('Stopped after 60 s; narrow your search.');
    if(n.queryCut||(st&&st.queryCut))out.push(CUT);
    if(n.mcpValuesLocked)out.push(LOCKED);
    return out.join(' ');
  }
  /* US3.4: the live region says the progress at most every 2 s */
  const announceDue=(last,now)=>!(typeof last==='number'&&now-last<2000);

  /* FR-013 (T042): which message of the chat to jump to. keys = anchorKey of each text message, in order; the nth one if it begins with
     `head`, else the nearest one that does (a different replay cap or a message added since), else -1 ("older than the chat shows") */
  function pickAnchor(keys,anchor){
    const a=anchor||{}, head=String(a.head||''), n=+a.n;
    if(!head)return -1;
    const ok=i=>typeof keys[i]==='string'&&keys[i].startsWith(head);
    if(Number.isInteger(n)&&ok(n))return n;
    let best=-1,bd=Infinity;
    for(let i=0;i<keys.length;i++)if(ok(i)){const d=Math.abs(i-(Number.isInteger(n)?n:0));if(d<bd){bd=d;best=i;}}
    return best;
  }

  return {dropBidi,moreOf,keyOf,longEnough,create,addBatch,finish,resort,sorted,count,markedHTML,excerptHTML,accName,stateText,notesText,LOCKED,announceDue,pickAnchor};
})());
