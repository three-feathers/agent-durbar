/* Switching the model / context tier of a session (spec 030). Pure: no DOM, no I/O; prices come from the runtime, never made up.
   Units: credits per million tokens (1 AI credit = USD 0.01); a missing price means "not reported", never zero.
   In the page: window.DurbarModels; in Node: module.exports. The IPC validation lives in src/shared/modelswitch.ts. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarModels=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const pos=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
  const nn=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
  const CLASS_RANK={low:1,medium:2,high:3,'very-high':4};
  const trim=s=>s.replace(/\.0+$/,'').replace(/(\.\d)0$/,'$1');

  /* The runtime reports a price per `batchSize` tokens; the UI shows credits per million tokens. Anything unusable is "not reported". */
  function pricingFromBatch(price,batchSize){
    if(!pos(price)||!pos(batchSize))return undefined;
    return price/batchSize*1e6;
  }

  /* Prices of a model at a tier: {input, output, cached} (each a number or undefined), or null when it reports none.
     A long tier with no long prices is "not reported" too (never the standard prices under another name). */
  function priceOf(model,tier){
    const p=model&&model.pricing; if(!p)return null;
    const t=tier==='long'?p.long:p; if(!t)return null;
    const r={input:pos(t.inputPerMTok)?t.inputPerMTok:undefined,output:pos(t.outputPerMTok)?t.outputPerMTok:undefined,cached:pos(t.cachedPerMTok)?t.cachedPerMTok:undefined};
    return r.input===undefined&&r.output===undefined?null:r;
  }

  /* Window of a model at a tier in tokens; 0 = not reported. */
  function windowOf(model,tier){
    if(!model)return 0;
    if(tier==='long'&&pos(model.longWindow))return model.longWindow;
    return pos(model.contextWindow)?model.contextWindow:0;
  }
  const hasLong=m=>!!(m&&Array.isArray(m.contextTiers)&&m.contextTiers.includes('long'));

  /* Spec 030 FR-060, FR-061: one change (a model, an effort or a window) on top of the whole choice, so the others are kept in any order.
     base: {model, effort (string, null = the model's default, undefined = none chosen), tier}; change: {model?, effort?, tier?}; modelOf(id) gives the model's entry.
     What the target model cannot do is dropped and named in `dropped`, never sent: the runtime would refuse the switch.
     Returns {req:{model, contextTier, effort?}, dropped:{effort?, tier?}}: a request describes the whole state. */
  function mergeChoice(base,change,modelOf){
    const tgt=modelOf(change.model!==undefined?change.model:base.model)||{id:change.model!==undefined?change.model:base.model,efforts:[]};
    const dropped={};
    let effort=change.effort!==undefined?change.effort:base.effort;
    if(typeof effort==='string'&&effort&&!(tgt.efforts||[]).includes(effort)){dropped.effort=effort;effort=null;}
    if(effort==='')effort=null;
    let tier=change.tier||base.tier||'default';
    if(tier==='long'&&!hasLong(tgt)){dropped.tier='long';tier='default';}
    return {req:Object.assign({model:tgt.id,contextTier:tier==='long'?'long':'default'},effort!==undefined?{effort}:{}),dropped};
  }
  /* The request changes nothing on top of `base` (FR-061): no call, no toast. */
  const sameChoice=(base,req)=>req.model===base.model&&(req.contextTier||'default')===(base.tier||'default')&&(req.effort||'')===(base.effort||'');
  /* The words of a whole choice, for the queued line and the toast: "high effort, long context" ('' when there is nothing to add). */
  const choiceWords=req=>[req&&req.effort?req.effort+' effort':'',req&&req.contextTier==='long'?'long context':''].filter(Boolean).join(', ');
  /* FR-062: what a new model could not keep, said in the toast or the dialog instead of silently lost. */
  function droppedText(dropped,name){
    const w=[dropped&&dropped.effort?dropped.effort+' effort':'',dropped&&dropped.tier?'long context':''].filter(Boolean);
    return w.length?name+' does not offer '+w.join(' or ')+', so '+(w.length>1?'they are':'it is')+' not kept.':'';
  }

  /* How the target compares with the current model: {direction:'cheaper'|'equal'|'pricier'|'unknown', input, output, basis}.
     input/output are ratios (target / current) when both prices are reported. Fallbacks: price class, then the legacy multiplier. */
  function relativePrice(cur,tgt,tierFrom,tierTo){
    const a=priceOf(cur,tierFrom),b=priceOf(tgt,tierTo);
    if(a&&b){
      const input=a.input&&b.input?b.input/a.input:undefined,output=a.output&&b.output?b.output/a.output:undefined;
      const rs=[input,output].filter(x=>x!==undefined);
      if(rs.length){
        const eq=x=>Math.abs(x-1)<1e-9;
        const direction=rs.some(x=>x>1&&!eq(x))?'pricier':rs.every(eq)?'equal':'cheaper';
        return {direction,input,output,basis:'price'};
      }
    }
    if(cur&&tgt&&CLASS_RANK[cur.priceClass]&&CLASS_RANK[tgt.priceClass]){
      const x=CLASS_RANK[tgt.priceClass],y=CLASS_RANK[cur.priceClass];
      return {direction:x>y?'pricier':x===y?'equal':'cheaper',basis:'class'};
    }
    if(cur&&tgt&&nn(cur.multiplier)&&nn(tgt.multiplier)&&(!a||!b)){
      const x=tgt.multiplier,y=cur.multiplier;
      return {direction:x>y?'pricier':x===y?'equal':'cheaper',basis:'multiplier'};
    }
    return {direction:'unknown',basis:'none'};
  }

  /* Rough cost in credits of the model reading `tokens` of input once, with nothing cached (an estimate, not a bill). */
  const unverifiedPrice=m=>!!(m&&m.pricing&&m.pricing.unverified);
  function estimateInputCredits(tokens,model,tier){
    if(unverifiedPrice(model))return undefined; /* the unit of the runtime's prices was never checked: no credit figure is shown or compared with the cap */
    /* spec 030 T044 (real 2026-10-20): on the long tier, a context that fits the default window is billed at the default price */
    const def=model&&pos(model.contextWindow)?model.contextWindow:0;
    const p=priceOf(model,tier==='long'&&def&&nn(tokens)&&tokens<=def?'default':tier);
    if(!p||p.input===undefined||!nn(tokens))return undefined;
    return tokens/1e6*p.input;
  }

  const hasPrice=m=>!!(priceOf(m,'default')||priceOf(m,'long')||(m&&CLASS_RANK[m.priceClass])||(m&&nn(m.multiplier)));

  function fmtCredits(n){
    if(!nn(n))return '?';
    if(n>=100)return String(Math.round(n));
    if(n>=10)return trim(n.toFixed(1));
    if(n>=0.1)return trim(n.toFixed(2));
    return n===0?'0':'<0.1';
  }
  function fmtRatio(r){
    if(!pos(r))return '?';
    return trim(r>=10?String(Math.round(r)):r.toFixed(1))+'×';
  }
  function fmtTokens(n){
    if(!nn(n))return '?';
    if(n>=1e6)return trim((n/1e6).toFixed(n>=1e7?0:1))+'M';
    if(n>=1000)return trim((n/1000).toFixed(n>=1e5?0:1))+'k';
    return String(Math.round(n));
  }
  /* One short line for a menu row: price per million tokens (or its class), or an honest "not reported". */
  function priceLine(m,tier){
    const p=priceOf(m,tier||'default');
    if(p)return (p.input!==undefined?'in '+fmtCredits(p.input):'')+(p.input!==undefined&&p.output!==undefined?' · ':'')+(p.output!==undefined?'out '+fmtCredits(p.output):'')+' credits per M tokens'+(unverifiedPrice(m)?' (unit not verified)':'');
    if(m&&CLASS_RANK[m.priceClass])return m.priceClass.replace('-',' ')+' price class';
    if(m&&nn(m.multiplier))return '×'+m.multiplier+' cost multiplier';
    return 'price not reported';
  }

  /* What must be confirmed before a switch (spec 030 FR-004, FR-005): a pricier model, an unreported price, the long tier, a bigger bill than the cap
     leaves, or a smaller window than the context in use. Cheaper or equal switches need none and apply with an Undo.
     ctx: {tokens (context in use), cap (credits, optional), used (credits so far, optional), tierFrom, tierTo}. The cap is never changed here. */
  function confirmFor(cur,tgt,ctx){
    ctx=ctx||{};
    const tierFrom=ctx.tierFrom||'default',tierTo=ctx.tierTo||'default';
    const name=tgt&&tgt.name||tgt&&tgt.id||'the new model',from=cur&&cur.name||cur&&cur.id||'the current model';
    const rel=relativePrice(cur,tgt,tierFrom,tierTo);
    const reasons=[];
    const targetPriced=hasPrice(tgt)&&(tierTo!=='long'||priceOf(tgt,'long')||CLASS_RANK[tgt.priceClass]||nn(tgt.multiplier));
    if(!targetPriced)reasons.push({code:'unpriced',text:'The price of '+name+(tierTo==='long'?' on the long-context tier':'')+' is not reported, so the cost cannot be compared.'});
    else if(rel.direction==='unknown')reasons.push({code:'no-baseline',text:'The price of '+from+' is not reported, so the change cannot be compared.'});
    else if(rel.direction==='pricier'){
      const parts=[];
      if(rel.basis==='price'){ if(rel.input>1)parts.push('input '+fmtRatio(rel.input)); if(rel.output>1)parts.push('output '+fmtRatio(rel.output)); }
      reasons.push({code:'pricier',text:name+' costs more per token than '+from+(parts.length?' ('+parts.join(', ')+')':rel.basis==='class'?' (price class '+String(tgt.priceClass).replace('-',' ')+' vs '+String(cur.priceClass).replace('-',' ')+')':'')+'.'});
    }
    if(tierTo==='long'&&tierFrom!=='long'){
      const a=priceOf(tgt,'default'),b=priceOf(tgt,'long');
      const x=a&&b&&a.input&&b.input?' Input is '+fmtRatio(b.input/a.input)+' the standard price.':'';
      reasons.push({code:'long-tier',text:'Long-context tier: a larger window at a higher price per token.'+x});
    }
    const estimate=estimateInputCredits(ctx.tokens,tgt,tierTo);
    let headroom;
    if(pos(ctx.cap)){
      headroom=Math.max(0,ctx.cap-(nn(ctx.used)?ctx.used:0));
      if(estimate===undefined&&unverifiedPrice(tgt)&&rel.direction!=='cheaper'&&rel.direction!=='equal')reasons.push({code:'cap-unverified',text:'The prices reported for '+name+' are not verified yet, so the cost cannot be checked against your cap ('+fmtCredits(headroom)+' credits left).'});
      else if(estimate!==undefined&&estimate>headroom)reasons.push({code:'over-headroom',text:'Reading this conversation once could use about '+fmtCredits(estimate)+' credits (estimate); '+fmtCredits(headroom)+' are left under the cap.'});
    }
    const win=windowOf(tgt,tierTo);
    const compaction=win>0&&nn(ctx.tokens)&&ctx.tokens>win;
    if(compaction)reasons.push({code:'smaller-window',text:'The context in use ('+fmtTokens(ctx.tokens)+' tokens) is larger than the window of '+name+' ('+fmtTokens(win)+'). It is compacted first, which costs one model call.'});
    return {needed:reasons.length>0,direction:rel.direction,reasons,estimate,headroom,relative:rel,compaction,overCap:reasons.some(r=>r.code==='over-headroom'),unverifiedPrice:unverifiedPrice(tgt)};
  }

  /* Suggest a fresh session near the limit (spec 030 FR-013): at 90% or more, after a compaction already ran (or failed), or at once when the
     agent cannot compact; only while idle, and never again once the user dismissed the note. */
  function suggestFresh(s){
    s=s||{};
    if(s.dismissed||!s.idle||!(s.percent>=90))return false;
    if(s.canCompact===false)return true;
    return (s.compactions>0)||s.lastCompactionFailed===true;
  }

  const TRIGGER={auto:'automatic','model-switch':'before the model switch',manual:'manual',overflow:'after the window was exceeded',truncation:'the oldest messages were dropped'};
  /* spec 015 FR-006: 'unknown' = the agent app does not say who started it, so no bracket; a word that is not in the table reads like auto (as before) */
  const howOf=e=>e.trigger==='unknown'?'':' ('+(typeof e.trigger==='string'&&Object.prototype.hasOwnProperty.call(TRIGGER,e.trigger)?TRIGGER[e.trigger]:'automatic')+')';
  /* The one line a compaction leaves in the chat. Plain text (the caller escapes it). */
  function compactionText(e){
    if(!e)return '';
    const how=howOf(e);
    if(e.phase==='start')return 'Compacting the context'+how+'…';
    if(e.phase==='failed')return 'Compaction failed'+(e.error?': '+String(e.error).slice(0,200):'')+'. The conversation is unchanged.';
    const grew=nn(e.tokensBefore)&&nn(e.tokensAfter)&&e.tokensAfter>e.tokensBefore;
    const span=nn(e.tokensBefore)&&nn(e.tokensAfter)?': '+fmtTokens(e.tokensBefore)+' → '+fmtTokens(e.tokensAfter)+' tokens'+(grew?' (too short to shrink)':''):nn(e.tokensRemoved)?': '+fmtTokens(e.tokensRemoved)+' tokens removed':nn(e.tokensBefore)?': it held '+fmtTokens(e.tokensBefore)+' tokens':'';
    return (e.trigger==='truncation'?'Older messages dropped to fit the window':'Context compacted'+how)+span+'.';
  }
  /* spec 015 FR-010 (issue 601): is this agent compacting right now, for the desk, list, header and strip? A live, main, un-paused agent whose
     compaction is open; Waiting, Error and Done keep their own word (a compaction does not hide a question or a failure). Pure. */
  function compactingNow(a){
    return !!a&&!a.parent&&!!a.live&&!a.paused&&a.compacting===true&&a.state!=='waiting'&&a.state!=='error'&&a.state!=='done';
  }
  const COMPACTING_LINE='Compacting the conversation…';
  /* spec 052 FR-163: compactions in a row fold into one line that updates in place. `n` = compactions done in this run of lines
     (after this event), `at` = the time of the last one ("10:21"). One compaction reads exactly like compactionText. */
  function compactionFoldText(e,n,at){
    if(!e)return '';
    if(e.trigger==='truncation')return compactionText(e); /* spec 015 FR-009: dropped messages are not a summary and never fold into "compacted N times" */
    if(!(n>=1)||(n===1&&e.phase==='complete'))return compactionText(e);
    const times=n===1?'once':n+' times', head='Context compacted '+times+(at?' · last '+at:'');
    if(e.phase==='start')return head+' · compacting again…';
    if(e.phase==='failed')return head+' · the next one failed'+(e.error?': '+String(e.error).slice(0,200):'')+'. The conversation is unchanged.';
    const span=nn(e.tokensBefore)&&nn(e.tokensAfter)?': '+fmtTokens(e.tokensBefore)+' → '+fmtTokens(e.tokensAfter)+' tokens':nn(e.tokensRemoved)?': '+fmtTokens(e.tokensRemoved)+' tokens removed':nn(e.tokensBefore)?': it held '+fmtTokens(e.tokensBefore)+' tokens':'';
    return head+span+'.';
  }
  /* ---- Spec 007 FR-012..FR-017: the routing preference of Copilot's Auto, cheapest first. Pure. ---- */
  const AUTO_TIERS=['efficiency','balance','intelligence'];
  const AUTO_TIER_NAME={efficiency:'Efficiency',balance:'Balance',intelligence:'Intelligence'};
  const AUTO_TIER_HINT={efficiency:'Auto picks the cheapest models that fit',balance:'Auto balances cost and capability',intelligence:'Auto picks the most capable models'};
  const isTier=t=>typeof t==='string'&&AUTO_TIERS.includes(t);
  /* The tiers the menu shows for a model: only on `auto`, only the three names, in their order (anything else the list carries is ignored). */
  function autoTiersOf(m){
    if(!m||m.id!=='auto'||!Array.isArray(m.autoTiers))return [];
    return AUTO_TIERS.filter(t=>m.autoTiers.includes(t));
  }
  /* The tier in effect: a locked organization tier, else the agent's own, else the organization's default, else Efficiency (what a new Auto session gets).
     A lock on a tier outside the three names (FR-017, fails closed) is in effect too, but cannot be named: ''. */
  function autoTierOf(m,own){
    const g=m&&m.autoTierManaged&&typeof m.autoTierManaged==='object'?m.autoTierManaged:null;
    if(g&&g.locked===true)return isTier(g.tier)?g.tier:'';
    if(isTier(own))return own;
    if(g&&isTier(g.tier))return g.tier;
    return 'efficiency';
  }
  const autoTierLocked=m=>!!(m&&m.autoTierManaged&&typeof m.autoTierManaged==='object'&&m.autoTierManaged.locked===true); /* fails closed: also with no name */
  /* FR-014: a higher tier asks first (Auto may route to models that cost more per token, and a tier's price is not reported); a lower or equal one does not. */
  function autoTierConfirm(from,to){
    if(!isTier(to))return {needed:false,valid:false,reasons:[]};
    const a=AUTO_TIERS.indexOf(isTier(from)?from:'efficiency'),b=AUTO_TIERS.indexOf(to);
    if(b<=a)return {needed:false,valid:true,reasons:[]};
    return {needed:true,valid:true,reasons:[
      'With '+AUTO_TIER_NAME[to]+' routing, Auto may pick models that cost more per token than with '+AUTO_TIER_NAME[AUTO_TIERS[a]]+'.',
      'The price of a routing tier is not reported, so the cost cannot be compared before the next message.']};
  }
  const autoTierName=t=>isTier(t)?AUTO_TIER_NAME[t]:'';
  const FAIL_WHY={'policy-rejected':'the model it picked is not allowed by policy','request-failed':'the routing request failed','setup-failed':'the routing could not be prepared','unsupported':'your Copilot provider does not support Auto routing'};
  /* FR-019: the note after a tier switch the runtime could not apply; it names the tier still in effect. Plain text. */
  function autoTierFailText(e){
    if(!e)return '';
    const want=isTier(e.requested)?AUTO_TIER_NAME[e.requested]+' routing':'the default routing';
    const now=isTier(e.effective)?AUTO_TIER_NAME[e.effective]+' routing':'its default routing';
    const why=typeof e.reason==='string'&&Object.prototype.hasOwnProperty.call(FAIL_WHY,e.reason)?FAIL_WHY[e.reason]:''; /* own keys only */
    return 'Copilot could not switch Auto to '+want+(why?' ('+why+')':'')+'. It still uses '+now+'.';
  }

  const CAUSE={'rate-limit':'because of a rate limit','fallback':'because the request was refused','runtime':'by the runtime','resume':'when the session resumed'};
  /* The line for a model change: ours says what happened; one the runtime made says so plainly (spec 030 FR-015). */
  function modelChangeText(e,nameOf){
    if(!e)return '';
    const nm=nameOf||(x=>x);
    const to=nm(e.model),from=e.previousModel?nm(e.previousModel):'';
    const rt=e.model==='auto'&&isTier(e.autoTier)?' ('+AUTO_TIER_NAME[e.autoTier]+' routing)':''; /* spec 007 FR-013 */
    if(e.cause==='user')return 'Model set to '+to+rt+(e.tier==='long'?' (long context)':'')+'. The next message uses it.';
    return 'The runtime changed the model'+(from?' from '+from:'')+' to '+to+' '+(CAUSE[e.cause]||CAUSE.runtime)+'. The next message uses it.';
  }

  /* ---- Agent kinds and what each can do (spec 012 T017, FR-059..FR-061). Pure. `adapters` is the list from bridge.listAdapters();
     without a list (a bridge that has none, or the call failed) every capability counts as on, so the UI stays as it was. ---- */
  const ALL_ON={interrupt:true,resume:true,images:true,models:true,effort:true,permissionModes:['read-only','ask','allow'],permModeSwitch:'live',usage:{tokens:true,costUsd:true,nanoAiu:true},context:true,caps:true,helpers:true,history:true,mcpStatus:true,mcpToggle:true,handoff:true};
  const haveList=a=>Array.isArray(a)&&a.length>0;
  /* The capabilities of the adapter that runs `info`; all on when the list is missing or does not know the id. */
  function capsOf(info,adapters){
    if(!haveList(adapters)||!info)return ALL_ON;
    const ad=adapters.find(x=>x&&x.id===info.adapterId);
    return ad&&ad.capabilities&&typeof ad.capabilities==='object'?ad.capabilities:ALL_ON;
  }
  const KIND_STATE={'ready':'','not-installed':'not installed','too-old':'too old','not-signed-in':'not signed in','unknown':'unknown'};
  const HINT_MAX=200;
  /* One entry per adapter for the select and the "About agent kinds" dialog. Only a `ready` kind can be chosen; the others are disabled and say why. */
  function kindChoices(adapters){
    if(!Array.isArray(adapters))return [];
    return adapters.filter(a=>a&&typeof a.id==='string').map(a=>{
      const state=Object.prototype.hasOwnProperty.call(KIND_STATE,a.state)?a.state:'unknown';
      const name=typeof a.displayName==='string'&&a.displayName?a.displayName:a.id;
      const stateText=KIND_STATE[state];
      return {id:a.id,name,shortName:name.replace(/\s*\([^)]*\)\s*$/,'')||name,state,stateText,disabled:state!=='ready',label:stateText?name+': '+stateText:name,
        version:typeof a.version==='string'?a.version.slice(0,HINT_MAX):'',hint:typeof a.hint==='string'?a.hint.slice(0,HINT_MAX):''};
    });
  }
  /* spec 030 FR-042 (#409): the agent apps a conversation can continue in: every ready app except its own, in the list's order. */
  function handoverTargets(adapters,currentKind){
    const cur=currentKind||'copilot';
    return kindChoices(adapters).filter(k=>!k.disabled&&k.id!==cur);
  }
  /* FR-043: the first line of a summary that moves to another app, so the new session (and the user) see where it came from. */
  function provenanceLine(fromApp,agentName){
    const app=String(fromApp||'').replace(/\s+/g,' ').trim().slice(0,60);
    const who=String(agentName||'').replace(/\s+/g,' ').trim().slice(0,60);
    return 'Continued from '+(app?'a '+app+' session':'another agent app')+(who?' ('+who+')':'')+' in this folder. Its summary:';
  }
  /* The kind select appears only when there is a real choice. */
  const showsKindPicker=adapters=>Array.isArray(adapters)&&adapters.filter(a=>a&&a.state==='ready').length>=2; /* spec 012 FR-136: only a real choice between ready harnesses */
  /* Is a control shown? A feature the adapter lacks is hidden, never shown disabled (SC-003). `modeList` takes the mode: shows(caps,'modeList','ask'). */
  function shows(caps,feature,mode){
    const c=caps||ALL_ON;
    switch(feature){
      case 'stop':return !!c.interrupt;
      case 'modes':return c.permModeSwitch!=='none';
      case 'modeList':return Array.isArray(c.permissionModes)&&c.permissionModes.includes(mode);
      case 'cap':return !!c.caps;
      case 'mcp':return !!c.mcpStatus;
      case 'mcpToggle':return !!c.mcpStatus&&!!c.mcpToggle;
      case 'mcpRestart':return !!c.mcpStatus&&c.mcpRestart===true; /* spec 058 FR-012: never assumed */
      case 'history':return !!c.history;
      case 'models':return !!c.models;
      case 'effort':return !!c.effort;
      case 'handoff':return !!c.handoff; /* spec 030 FR-036 */
      case 'deleteSession':return c.deleteSession===true; /* spec 006 FR-028: never assumed; the menu shows Delete… disabled with the reason */
      case 'remote':return !!c.remote; /* spec 054 FR-006: never assumed, also not when the kind is unknown */
      default:return true;
    }
  }

  /* Spec 005 FR-017: what the office card menu adds for a live main agent. Stop only while a turn runs (disabled with the reason when the kind cannot interrupt);
     End session for a started, not yet ended session, and it asks first while the agent is busy or waiting. `a` is the main agent: {live,parent,state,label,info}. */
  function cardMenuActions(a,caps){
    const none={stop:null,end:null};
    if(!a||!a.live||a.parent)return none;
    const run=a.state==='working'||a.state==='thinking';
    const out={stop:null,end:null};
    if(run)out.stop=shows(caps,'stop')?{disabled:false,reason:''}:{disabled:true,reason:'This agent cannot interrupt a running turn.'};
    const started=!(a.info&&a.info.lazy)&&a.label!=='Ended'&&a.label!=='Not started';
    if(started)out.end={confirm:run||a.state==='waiting'};
    return out;
  }
  /* The modes an adapter can enforce, in the order the UI lists them. Missing or empty means read-only only (safe by default), unlike `shows`, which counts a missing caps object as all on. */
  const MODE_ORDER=['read-only','ask','allow'];
  function modesFor(caps){
    const c=caps||{};
    const m=Array.isArray(c.permissionModes)?MODE_ORDER.filter(k=>c.permissionModes.includes(k)):[];
    return m.length?m:['read-only'];
  }
  /* The mode to keep when the kind changes: the current one when allowed, else read-only; never a wider mode. */
  function fallbackMode(caps,cur){
    const m=modesFor(caps);
    return m.includes(cur)?cur:'read-only';
  }

  return {mergeChoice,sameChoice,choiceWords,droppedText,compactingNow,COMPACTING_LINE,AUTO_TIERS,AUTO_TIER_HINT,autoTiersOf,autoTierOf,autoTierLocked,autoTierConfirm,autoTierName,autoTierFailText,handoverTargets,provenanceLine,modesFor,fallbackMode,pricingFromBatch,priceOf,windowOf,hasLong,relativePrice,estimateInputCredits,confirmFor,suggestFresh,compactionText,compactionFoldText,modelChangeText,fmtCredits,fmtRatio,fmtTokens,priceLine,hasPrice,capsOf,kindChoices,showsKindPicker,shows,cardMenuActions};
})());
