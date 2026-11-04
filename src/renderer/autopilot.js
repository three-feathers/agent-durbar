/* Spec 099 Phase 3: the words of Autopilot in the window, and its settings form. Pure text and createElement/textContent only, so hostile names and numbers cannot become markup;
   in Node (tests) `require` gives the same object. The form grants nothing (FR-055): the consent is main's native dialog. No vendor names: the app's name is passed in. */
(function(root,factory){const m=factory();if(typeof module==='object'&&module.exports)module.exports=m;else root.DurbarAutopilot=m;})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const DEFAULT_LIMIT=5,DEFAULT_HOURS=2,MAX_LIMIT=1000,MIN_HOURS=1,MAX_HOURS=168,LIMIT_WARN=20,HOURS_WARN=2;
  /* FR-005: the adapters' fixed line; `test-autopilot-window` compares it with autopilotHost.ts */
  const CLOSED_LINE='Autopilot ended when this session closed. It is in Allow all.';
  const NOT_VERIFIED='Not verified on a real session yet.';
  const WARN_LIMIT='Above 20 extra turns, this run can spend much more before it stops.';
  const WARN_HOURS='Above 2 hours, this run can spend much more before it stops.';
  const REMOTE='Stop remote control first: Autopilot and remote control from GitHub are never on together.';
  const HELP='Allow all, and the agent keeps going after each answer until the app judges the task done, and decides its own questions. You confirm it each time. Stop ends it at once.';
  const SHORT='Keeps going until done; decides its own questions';
  /* FR-040: a word and an icon for each end, never colour alone. The icons are plain characters. */
  const ENDS={done:{icon:'✓',words:app=>(app||'The agent app')+' judged the task done'},cap:{icon:'■',words:()=>'the spend cap was reached'},limit:{icon:'■',words:()=>'the turn limit was reached'},'no-progress':{icon:'○',words:()=>'no progress in two turns'},blocked:{icon:'!',words:()=>'blocked, it could not go on'},stopped:{icon:'■',words:()=>'stopped by you'},error:{icon:'!',words:()=>'an error, or Durbar could not confirm its turns'}};
  const num=v=>typeof v==='number'&&isFinite(v);
  const short=v=>Math.round(v*1e4)/1e4;
  const unitWord={aiu:'AI credits',usd:"US dollars (Claude's estimate)",tokens:'tokens'};
  function money(unit,v){if(!num(v))return '';v=short(v);return unit==='usd'?'$'+v:unit==='tokens'?v+' tokens':v+' AI credits';}
  const turns=n=>n+' more turn'+(n===1?'':'s');
  function capText(ap,unit){return ap&&num(ap.cap)&&unit?money(unit,ap.cap):'no spend cap';}
  const chipLabel=ap=>ap&&ap.run?'Autopilot · '+ap.run.continuation+'/'+ap.limit:'Autopilot';
  /* FR-056, D13: the limit, the cap or "no spend cap", what was spent, in the person's unit, and the verified line */
  function tooltip(ap,unit,spent,verified){
    const s=[(ap&&ap.run?'Autopilot: turn '+ap.run.continuation+' of up to '+ap.limit:'Autopilot: up to '+turns(ap?ap.limit:0)+' per message')+', '+capText(ap,unit)+'.'];
    if(unit&&num(spent))s.push('Spent so far: '+money(unit,spent)+'.');
    if(!verified)s.push(NOT_VERIFIED);
    s.push('Click to change.');
    return s.join(' ');
  }
  const startLine=(ap,unit)=>'Autopilot: working on your message (up to '+turns(ap?ap.limit:0)+', '+capText(ap,unit)+')';
  const contLine=(n,limit)=>'Autopilot: continuing ('+n+' of up to '+limit+')';
  /* FR-040: "Autopilot ended: <reason words>, after N more turns[, <spend>]" */
  function endLine(e,app){const k=Object.prototype.hasOwnProperty.call(ENDS,e.reason)?e.reason:'error';const sp=e.spend&&num(e.spend.value)?', '+money(e.spend.unit,e.spend.value):'';return 'Autopilot ended: '+ENDS[k].words(app)+', after '+turns(e.n)+sp;}
  const endIcon=r=>(Object.prototype.hasOwnProperty.call(ENDS,r)?ENDS[r]:ENDS.error).icon;
  const placeholder=app=>'Describe the finished result. '+(app||'The agent app')+' keeps going until it is done.';
  const attachTip=app=>'On Autopilot '+(app||'this app')+' takes text only: its goal is set from your message.';
  const noCap=hours=>'No spend cap: Autopilot stops when the task is done, at the turn limit, after '+hours+' hour'+(hours===1?'':'s')+', when it makes no progress, or when you press Stop.';
  /* the value last used, if it is one; else the default (S1) */
  const startLimit=v=>Number.isInteger(v)&&v>=1&&v<=MAX_LIMIT?v:DEFAULT_LIMIT;

  /* FR-055's form: { node, value(), valid(), onChange }. The numbers are read here for the window's sake only; main reads them again. */
  function form(doc,o){
    const el=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
    const node=el('div','ap-form');
    const app=o.app||'The agent app',unit=o.unit||null;
    const field=(lead,tail,val,id,min,max,step)=>{const l=el('label','ap-row');l.appendChild(el('span','ap-lbl',lead));const i=el('input','ap-num');i.type='number';i.id=id;i.min=String(min);i.max=String(max);i.step=String(step);i.value=String(val);l.appendChild(i);l.appendChild(el('span','ap-lbl',tail));node.appendChild(l);const w=el('p','ap-warn');w.id=id+'W';w.hidden=true;node.appendChild(w);return {i,w};};
    const lim=field('Keep going for at most','more turns per message',startLimit(o.limit),'apLimit',1,MAX_LIMIT,1);
    const hrs=field('Stop after','hours',DEFAULT_HOURS,'apHours',MIN_HOURS,MAX_HOURS,1);
    let box=null,capI=null,counts=null,raised=null;
    if(unit){
      const l=el('label','ap-row ap-capline');box=el('input');box.type='checkbox';box.id='apCapOn';l.appendChild(box);l.appendChild(el('span','ap-lbl','Stop at a spend cap of'));capI=el('input','ap-num');capI.type='number';capI.id='apCap';capI.min=unit==='usd'?'0.01':'1';capI.step=unit==='usd'?'0.01':'1';capI.disabled=true;l.appendChild(capI);l.appendChild(el('span','ap-lbl',unitWord[unit]||''));node.appendChild(l);
      const sp=num(o.spent)?money(unit,o.spent):'';
      counts=el('p','ap-hint',unit==='tokens'?'for this run. '+app+' finishes the turn it is in, so it can go a little over.':'for this session in total ('+(sp||'nothing')+' so far)');counts.id='apCounts';counts.hidden=true;node.appendChild(counts);
      if(unit==='aiu'){raised=el('p','ap-hint',"Copilot's smallest cap is 30 AI credits, so Autopilot uses 30.");raised.id='apRaised';raised.hidden=true;node.appendChild(raised);}
    }
    const none=el('p','ap-hint');none.id='apNoCap';node.appendChild(none);
    const own=num(o.ownCap)&&unit&&unit!=='tokens'?el('p','ap-hint',"This session's limit of "+money(unit,o.ownCap)+' still applies.'):null;if(own)node.appendChild(own);
    if(o.mode&&o.mode!=='allow'){const f=el('p','ap-warn ap-folder',(o.folder||'This folder')+' becomes Allow all, and stays so after Autopilot ends.');f.id='apFolder';node.appendChild(f);}
    if(!o.verified)node.appendChild(el('p','ap-hint',NOT_VERIFIED));
    node.appendChild(el('p','ap-hint',"Next, Agent Durbar asks you to confirm in its own dialog."));
    const limit=()=>Number(lim.i.value),hours=()=>Number(hrs.i.value),capOn=()=>!!(box&&box.checked),cap=()=>Number(capI&&capI.value);
    const valid=()=>Number.isInteger(limit())&&limit()>=1&&limit()<=MAX_LIMIT&&isFinite(hours())&&hours()>=MIN_HOURS&&hours()<=MAX_HOURS&&(!capOn()||(lim.i.value!==''&&capI.value!==''&&isFinite(cap())&&cap()>0&&(unit!=='tokens'||Number.isInteger(cap()))));
    const paint=()=>{
      lim.w.hidden=!(limit()>LIMIT_WARN);lim.w.textContent=lim.w.hidden?'':WARN_LIMIT;
      hrs.w.hidden=!(hours()>HOURS_WARN);hrs.w.textContent=hrs.w.hidden?'':WARN_HOURS;
      if(capI)capI.disabled=!capOn();if(counts)counts.hidden=!capOn();if(raised)raised.hidden=!(capOn()&&capI.value!==''&&cap()<30);
      none.hidden=capOn();none.textContent=capOn()?'':noCap(isFinite(hours())&&hours()>0?hours():DEFAULT_HOURS);
      if(api.onChange)api.onChange(valid());
    };
    const api={node,valid,onChange:null,paint,value:()=>Object.assign({limit:limit(),hours:hours()},capOn()?{cap:cap()}:{})};
    node.addEventListener('input',paint);node.addEventListener('change',paint);
    paint();
    return api;
  }
  return {CLOSED_LINE,NOT_VERIFIED,WARN_LIMIT,WARN_HOURS,REMOTE,HELP,SHORT,ENDS,money,capText,chipLabel,tooltip,startLine,contLine,endLine,endIcon,placeholder,attachTip,noCap,startLimit,form};
});
