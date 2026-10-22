/* Office and per-folder usage totals (spec 011 FR-018..FR-023). Pure: no DOM, numbers only, kept in memory for the run.
   In the page: window.DurbarUsage; in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarUsage=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const MAX_NANO=1e15;
  const MAX_LINES=8;
  const MAX_TIP=300; /* spec 052 FR-168: a data tooltip is at most 300 characters and 8 lines */
  /* A usable credit figure: a finite, non-negative number up to 1e15 nano-AIU (a typo or a bad field is "not reported"). */
  const validNano=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=MAX_NANO;
  const tok=x=>typeof x==='number'&&Number.isFinite(x)&&x>0?x:0;
  const blank=()=>({calls:0,inTokens:0,outTokens:0,nano:0,unreported:0});
  const copy=t=>({calls:t.calls,inTokens:t.inTokens,outTokens:t.outTokens,nano:t.nano,unreported:t.unreported});
  /* Sum of several totals (spec 033: the spend of the rooms on floors that are off). */
  const sum=list=>{const o=blank();(list||[]).forEach(t=>{if(!t)return;o.calls+=t.calls;o.inTokens+=t.inTokens;o.outTokens+=t.outTokens;o.nano+=t.nano;o.unreported+=t.unreported;});return o;};

  /* One ledger per run. record() is called once per `usage` event, for the folder (room id) of the owning agent; helpers are
     recorded through their parent's event, never twice. Nothing is ever subtracted: ended sessions and removed agents still count. */
  const addN=(a,b)=>({calls:a.calls+b.calls,inTokens:a.inTokens+b.inTokens,outTokens:a.outTokens+b.outTokens,nano:a.nano+b.nano,unreported:a.unreported+b.unreported});
  const cnt=x=>typeof x==='number'&&Number.isFinite(x)&&x>0?x:0;
  const normN=x=>{const o=x&&typeof x==='object'?x:{};return {calls:cnt(o.calls),inTokens:cnt(o.inTokens),outTokens:cnt(o.outTokens),nano:cnt(o.nano),unreported:cnt(o.unreported)};};
  /* Spec 011 FR-027 (issue #21): the totals saved before this run (the "baseline", from the main process) plus what this run records.
     The baseline never changes while the app runs (main keeps it frozen), so an event is never counted twice; a reset replaces it. */
  function createLedger(){
    const rooms=new Map();
    let base={office:blank(),folders:new Map(),since:'',unlisted:false};
    const runOffice=()=>{const o=blank();rooms.forEach(t=>{o.calls+=t.calls;o.inTokens+=t.inTokens;o.outTokens+=t.outTokens;o.nano+=t.nano;o.unreported+=t.unreported;});return o;};
    return {
      /* v: {since, office, folders:[{path, ...numbers}]} as the main process sends it. Anything odd counts as 0. */
      setBaseline(v){
        const o=v&&typeof v==='object'?v:{}; const folders=new Map(); let listed=blank();
        (Array.isArray(o.folders)?o.folders:[]).forEach(f=>{if(!f||typeof f.path!=='string')return;const n=normN(f);folders.set(f.path,n);listed=addN(listed,n);});
        const office=normN(o.office);
        base={office,folders,since:typeof o.since==='string'?o.since:'',unlisted:office.calls>listed.calls};
      },
      /* forget this run's figures (after a reset); the baseline is replaced by setBaseline */
      clearRun(){rooms.clear();},
      since(){return base.since;},
      /* true when the saved office total holds calls of folders that are not in the folder list now */
      hasUnlisted(){return base.unlisted;},
      record(roomId,e){
        if(roomId==null||!e)return;
        const k=String(roomId); let t=rooms.get(k); if(!t){t=blank();rooms.set(k,t);}
        t.calls++; t.inTokens+=tok(e.inputTokens); t.outTokens+=tok(e.outputTokens);
        if(validNano(e.nanoAiu))t.nano+=e.nanoAiu; else t.unreported++;
      },
      /* saved + this run for a folder; `key` is the folder key the main process uses (workspaceFile or cwd), omitted = this run only */
      room(id,key){const run=this.roomRun(id),b=key==null?undefined:base.folders.get(String(key));return b?addN(b,run):run;},
      roomRun(id){const t=rooms.get(String(id));return t?copy(t):blank();},
      roomIds(){return [...rooms.keys()];},
      office(){return addN(base.office,runOffice());},
      officeRun(){return runOffice();},
    };
  }

  const none=t=>!t||!t.calls;
  const allUnreported=t=>!none(t)&&t.unreported>=t.calls;
  const aiu=(t,d)=>(t.nano/1e9).toFixed(d)+' AIU';
  /* '1.23 AIU' | 'cost not reported' (every call lacked credits, never 0.00) | '' (no calls yet) */
  const fmtTotal=(t,digits=2)=>none(t)?'':allUnreported(t)?'cost not reported':aiu(t,digits);
  /* Short form for the closed door plate: '0.42 AIU' | 'n/r' | '' */
  const fmtShort=t=>none(t)?'':allUnreported(t)?'n/r':aiu(t,2);
  const fmtTokens=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(n>=1e4?0:1)+'k':String(Math.round(n));
  const plural=(n,w)=>n+' '+w+(n===1?'':'s');

  /* Tooltip text, at most 300 characters and 8 lines even with every optional line (spec 052 FR-168; test:usagetotals builds the worst case).
     opts.scope: 'office' | 'folder'; opts.removed: some spend belongs to folders no longer shown;
     opts.offFloors: the part of the office total spent on floors that are off (spec 033 FR-016; still counted). */
  function tooltip(t,opts){
    if(none(t))return '';
    const o=opts||{}, office=o.scope!=='folder';
    const since=typeof o.since==='string'&&/^\d{4}-\d{2}-\d{2}/.test(o.since)?o.since.slice(0,10):'';
    /* opts.full: every line, for the aria-label (a screen reader has no length limit).
       [priority, line]: shown in this order; when the text would pass MAX characters the lines of the lowest priority (the highest number) go first */
    const L=[[0,(office?'Office total: ':'Folder total: ')+(allUnreported(t)?'cost not reported':aiu(t,3))],
      [0,plural(t.calls,'call')+' · '+fmtTokens(t.inTokens)+' in / '+fmtTokens(t.outTokens)+' out']];
    if(t.unreported&&!allUnreported(t))L.push([1,plural(t.unreported,'call')+' without credits']);
    L.push([0,since?'Saved since '+since+' (reset in Settings); ended sessions included.':'Since Agent Durbar opened; ended sessions included.']);
    if(since&&o.run&&!none(o.run))L.push([4,'This run: '+(allUnreported(o.run)?'cost not reported':aiu(o.run,3))+' in '+plural(o.run.calls,'call')+'.']);
    if(office&&o.removed)L.push([5,'Includes folders no longer shown.']);
    if(office&&o.offFloors&&!none(o.offFloors))L.push([0,'Includes '+(allUnreported(o.offFloors)?plural(o.offFloors.calls,'call')+' with cost not reported':aiu(o.offFloors,3))+' from floors that are off.']);
    if(office&&typeof o.estimate==='string'&&o.estimate)L.push([0,o.estimate]); /* the only explanation of the "≈ $X" chip and the Copilot / Claude split (spec 052 FR-028): never dropped */
    L.push([0,'Copilot\'s figure: 1 AIU = 1 credit, not a bill.']);
    const keep=L.map(()=>true), len=()=>L.reduce((n,x,i)=>n+(keep[i]?x[1].length+1:0),-1);
    const count=()=>keep.filter(Boolean).length;
    while(!o.full&&(len()>MAX_TIP||count()>MAX_LINES)){let w=-1;L.forEach((x,i)=>{if(keep[i]&&x[0]>0&&(w<0||x[0]>L[w][0]))w=i;});if(w<0)break;keep[w]=false;}
    return L.filter((x,i)=>keep[i]).map(x=>x[1]).join('\n');
  }

  return {createLedger,validNano,fmtTotal,fmtShort,tooltip,fmtTokens,sum};
})());
