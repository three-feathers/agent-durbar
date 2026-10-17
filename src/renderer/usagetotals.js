/* Office and per-folder usage totals (spec 011 FR-018..FR-023). Pure: no DOM, numbers only, kept in memory for the run.
   In the page: window.DurbarUsage; in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarUsage=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const MAX_NANO=1e15;
  /* A usable credit figure: a finite, non-negative number up to 1e15 nano-AIU (a typo or a bad field is "not reported"). */
  const validNano=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=MAX_NANO;
  const tok=x=>typeof x==='number'&&Number.isFinite(x)&&x>0?x:0;
  const blank=()=>({calls:0,inTokens:0,outTokens:0,nano:0,unreported:0});
  const copy=t=>({calls:t.calls,inTokens:t.inTokens,outTokens:t.outTokens,nano:t.nano,unreported:t.unreported});

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
  /* '1.23 AIU' | 'credits not reported' (every call lacked credits, never 0.00) | '' (no calls yet) */
  const fmtTotal=(t,digits=2)=>none(t)?'':allUnreported(t)?'credits not reported':aiu(t,digits);
  /* Short form for the closed door plate: '0.42 AIU' | 'n/r' | '' */
  const fmtShort=t=>none(t)?'':allUnreported(t)?'n/r':aiu(t,2);
  const fmtTokens=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(n>=1e4?0:1)+'k':String(Math.round(n));
  const plural=(n,w)=>n+' '+w+(n===1?'':'s');

  /* Tooltip text. opts.scope: 'office' | 'folder'; opts.removed: some spend belongs to folders no longer shown. */
  function tooltip(t,opts){
    if(none(t))return '';
    const o=opts||{}, office=o.scope!=='folder';
    const lines=[(office?'Office total: ':'Folder total: ')+(allUnreported(t)?'credits not reported':aiu(t,3)),
      plural(t.calls,'call')+' · '+fmtTokens(t.inTokens)+' in / '+fmtTokens(t.outTokens)+' out tokens'];
    if(t.unreported&&!allUnreported(t))lines.push(plural(t.unreported,'call')+' did not report credits');
    const since=typeof o.since==='string'&&/^\d{4}-\d{2}-\d{2}/.test(o.since)?o.since.slice(0,10):'';
    lines.push(since?'Saved since '+since+' (reset in Settings); ended sessions are included.':'Since Agent Durbar opened; ended sessions are included.');
    if(since&&o.run&&!none(o.run))lines.push('Since the app opened (or the last reset): '+(allUnreported(o.run)?'credits not reported':aiu(o.run,3))+' in '+plural(o.run.calls,'call')+'.');
    if(office&&o.removed)lines.push('Includes folders no longer shown.');
    lines.push('As reported by the Copilot runtime (1 AIU = 1 AI credit, not verified against billing).');
    return lines.join('\n');
  }

  return {createLedger,validNano,fmtTotal,fmtShort,tooltip,fmtTokens};
})());
