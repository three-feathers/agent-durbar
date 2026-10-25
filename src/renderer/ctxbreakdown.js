/* The context ring's token summary (spec 005 FR-051, FR-052, FR-056; issue 627): the pure part. From the context figure the renderer
   keeps (toolstats.js setContext: tokens, limit and the parts the adapter reported) to the ring's level, tooltip and name, and one bar
   per reported type. Nothing is estimated: a part that was not reported is not shown, and an adapter that reports only a total gets
   "Breakdown not reported by <app>.". Same level steps and token words as toolstats.js (ctxLevel, fmtTokens).
   In the page: window.DurbarCtxBreakdown (after toolstats.js); in Node: module.exports (scripts/test-ctx-breakdown.ts). */
(function(root, factory){
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./toolstats.js')); else root.DurbarCtxBreakdown=factory(root.DurbarStats);
})(typeof self!=='undefined'?self:this, function(S){
  'use strict';
  /* the types, in the order VS Code's summary lists them; the field names are ContextEvent's (src/adapters/types.ts) */
  const PARTS=[['system','System instructions'],['toolDefinitions','Tool definitions'],['conversation','Chat messages']];
  const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
  const share=(v,of)=>of>0?Math.max(0,Math.min(100,Math.round(v/of*100))):0;

  /* ctx: {tokens, limit, system?, conversation?, toolDefinitions?} or null. o: {limit: the model list's window when the event has none,
     app: the agent app's name, waiting: the model just changed and the old figure belongs to the old window} */
  function summary(ctx,o){
    o=o||{};
    const app=o.app||'this agent app', fmt=S.fmtTokens;
    if(o.waiting==='truncation') return {known:false,limit:0,pct:null,level:'unknown',bars:[],note:'Older messages were dropped. The new size is reported with your next message.',
      tip:'Context: waiting for the next message after older messages were dropped',name:'Context window: waiting for the next message after older messages were dropped. Open the token summary'};
    if(o.waiting==='compaction') return {known:false,limit:0,pct:null,level:'unknown',bars:[],note:'The conversation was compacted. The new size is reported with your next message.',
      tip:'Context: waiting for the next message after the compaction',name:'Context window: waiting for the next message after the compaction. Open the token summary'}; /* spec 015 FR-012 */
    if(o.waiting) return {known:false,limit:0,pct:null,level:'unknown',bars:[],note:'The model changed. The new window is reported with your next message.',
      tip:'Context: waiting for the next message after the model change',name:'Context window: waiting for the next message after the model change. Open the token summary'};
    if(!ctx||!num(ctx.tokens)) return {known:false,limit:0,pct:null,level:'unknown',bars:[],note:'Not known yet. It shows after the first message.',
      tip:'Context: not known yet',name:'Context window: not known yet. Open the token summary'};
    const tokens=ctx.tokens, limit=num(ctx.limit)&&ctx.limit>0?ctx.limit:num(o.limit)&&o.limit>0?o.limit:0;
    const lv=S.ctxLevel(tokens,limit), of=limit>0?limit:tokens;
    const bars=[];let sum=0;
    for(const [key,label] of PARTS){const v=ctx[key];if(!num(v))continue;sum+=v;bars.push({key,label,tokens:v,share:share(v,of)});}
    if(bars.length&&tokens-sum>0)bars.push({key:'other',label:'Other',tokens:tokens-sum,share:share(tokens-sum,of)});
    const tip=lv.pct===null?'Context: '+fmt(tokens)+' tokens used, window size not reported':'Context '+lv.pct+'% of '+fmt(limit);
    const name=(lv.pct===null?'Context window: '+fmt(tokens)+' tokens used, window size not reported':'Context window '+lv.pct+'% used: '+fmt(tokens)+' of '+fmt(limit)+' tokens')+'. Open the token summary';
    return {known:true,tokens,limit,pct:lv.pct,level:lv.level,bars,note:bars.length?'':'Breakdown not reported by '+app+'.',tip,name};
  }
  return {summary,PARTS};
});
