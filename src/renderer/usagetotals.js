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
  /* Sum of several totals (spec 033: the spend of the rooms on floors that are off). */
  const sum=list=>{const o=blank();(list||[]).forEach(t=>{if(!t)return;o.calls+=t.calls;o.inTokens+=t.inTokens;o.outTokens+=t.outTokens;o.nano+=t.nano;o.unreported+=t.unreported;});return o;};

  /* One ledger per run. record() is called once per `usage` event, for the folder (room id) of the owning agent; helpers are
     recorded through their parent's event, never twice. Nothing is ever subtracted: ended sessions and removed agents still count. */
  function createLedger(){
    const rooms=new Map();
    return {
      record(roomId,e){
        if(roomId==null||!e)return;
        const k=String(roomId); let t=rooms.get(k); if(!t){t=blank();rooms.set(k,t);}
        t.calls++; t.inTokens+=tok(e.inputTokens); t.outTokens+=tok(e.outputTokens);
        if(validNano(e.nanoAiu))t.nano+=e.nanoAiu; else t.unreported++;
      },
      room(id){const t=rooms.get(String(id));return t?copy(t):blank();},
      roomIds(){return [...rooms.keys()];},
      office(){const o=blank();rooms.forEach(t=>{o.calls+=t.calls;o.inTokens+=t.inTokens;o.outTokens+=t.outTokens;o.nano+=t.nano;o.unreported+=t.unreported;});return o;},
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

  /* Tooltip text. opts.scope: 'office' | 'folder'; opts.removed: some spend belongs to folders no longer shown;
     opts.offFloors: the part of the office total spent on floors that are off (spec 033 FR-016; still counted). */
  function tooltip(t,opts){
    if(none(t))return '';
    const o=opts||{}, office=o.scope!=='folder';
    const lines=[(office?'Office total: ':'Folder total: ')+(allUnreported(t)?'credits not reported':aiu(t,3)),
      plural(t.calls,'call')+' · '+fmtTokens(t.inTokens)+' in / '+fmtTokens(t.outTokens)+' out tokens'];
    if(t.unreported&&!allUnreported(t))lines.push(plural(t.unreported,'call')+' did not report credits');
    lines.push('Since Agent Durbar opened; ended sessions are included.');
    if(office&&o.removed)lines.push('Includes folders no longer shown.');
    if(office&&o.offFloors&&!none(o.offFloors))lines.push('Includes '+(allUnreported(o.offFloors)?plural(o.offFloors.calls,'call')+' with credits not reported':aiu(o.offFloors,3))+' from floors that are off (their agents keep running).');
    lines.push('As reported by the Copilot runtime (1 AIU = 1 AI credit, not verified against billing).');
    return lines.join('\n');
  }

  return {createLedger,validNano,fmtTotal,fmtShort,tooltip,fmtTokens,sum};
})());
