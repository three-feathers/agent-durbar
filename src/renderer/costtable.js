/* Cost per folder (spec 052 FR-044, issue #315): rows, totals and the CSV text for the Tools > Cost view. Pure: no DOM, numbers and strings only.
   In the page: window.DurbarCost; in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarCost=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const AIU_USD=0.01; /* 1 Copilot AI credit = USD 0.01 */
  /* Plan reassurance (spec 052 FR-058, FR-075): one place for the words, used by the spending-limit dialog and Tools > Cost. */
  const PLAN_NOTE='Copilot, Claude and ChatGPT plans have a fixed monthly price; this limit only stops the agent. Durbar never charges you.';
  const COPILOT_PLAN_NOTE='Copilot plans, the free one too, have a fixed price; Durbar shows usage, it does not charge you.';
  const num=x=>typeof x==='number'&&Number.isFinite(x)&&x>0?x:0;
  const money=v=>v>0&&v<0.005?'<$0.01':'$'+num(v).toFixed(2);

  /* list: [{id,name,path,nano,calls,unreported,usd,tokens,tokensOnly}] (one per folder); office: the ledger's office total for the same
     period, or null. Returns {rows,total}: rows sorted by money (high to low), folders with no usage last; when the office total holds
     calls of folders not in the list (removed ones), one extra row `other` carries the difference so the total stays the office total. */
  function build(list,office){
    const rows=(Array.isArray(list)?list:[]).filter(Boolean).map(f=>{
      const nano=num(f.nano),usd=num(f.usd),calls=num(f.calls),unreported=num(f.unreported),tokens=num(f.tokens);
      return {id:String(f.id==null?'':f.id),name:String(f.name==null?'':f.name),path:String(f.path==null?'':f.path),nano,aiu:nano/1e9,usd,calls,unreported,tokens,
        tokensOnly:!!f.tokensOnly,money:nano/1e9*AIU_USD+usd,empty:!calls&&!usd&&!tokens,other:false};
    });
    const sum=k=>rows.reduce((n,r)=>n+r[k],0);
    if(office&&num(office.calls)>sum('calls')){
      const nano=Math.max(0,num(office.nano)-sum('nano'));
      rows.push({id:'',name:'Folders no longer shown',path:'',nano,aiu:nano/1e9,usd:0,calls:num(office.calls)-sum('calls'),unreported:Math.max(0,num(office.unreported)-sum('unreported')),
        tokens:0,tokensOnly:false,money:nano/1e9*AIU_USD,empty:false,other:true});
    }
    rows.sort((a,b)=>(a.empty-b.empty)||(b.money-a.money)||(b.calls-a.calls)||a.name.localeCompare(b.name));
    const total={name:'Total',nano:sum('nano'),aiu:sum('nano')/1e9,usd:sum('usd'),calls:sum('calls'),unreported:sum('unreported'),tokens:sum('tokens'),money:sum('money'),tokensOnly:rows.some(r=>r.tokensOnly)};
    return {rows,total};
  }
  /* "cost not reported": calls were made, none reported credits and there is no Claude estimate (never show $0.00 for that) */
  const notReported=r=>r.calls>0&&r.unreported>=r.calls&&!r.usd;

  /* One CSV field (RFC 4180): always quoted, `"` doubled. A value a spreadsheet would run as a formula (=, +, -, @, or a leading tab or
     carriage return) gets a leading apostrophe first. */
  function csvField(v){
    let s=v==null?'':String(v);
    if(/^[=+\-@\t\r]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  }
  const CSV_COLUMNS=['folder','money_usd_estimate','copilot_aiu','claude_usd_estimate','tokens','calls','period'];
  /* The table as CSV text (CRLF line ends): one line per row, then the total. `period` is the label shown ("This run", "Since 2026-10-01"). */
  function toCsv(built,period){
    const p=String(period==null?'':period);
    const line=r=>[r.name,r.money.toFixed(4),r.aiu.toFixed(3),r.usd.toFixed(4),String(Math.round(r.tokens)),String(Math.round(r.calls)),p].map(csvField).join(',');
    const b=built&&Array.isArray(built.rows)?built:{rows:[],total:build([]).total};
    return [CSV_COLUMNS.map(csvField).join(',')].concat(b.rows.map(line),[line(b.total)]).join('\r\n')+'\r\n';
  }

  return {AIU_USD,PLAN_NOTE,COPILOT_PLAN_NOTE,build,notReported,money,csvField,toCsv,CSV_COLUMNS};
})());
