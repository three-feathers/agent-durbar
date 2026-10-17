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
  function estimateInputCredits(tokens,model,tier){
    const p=priceOf(model,tier);
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
    if(p)return (p.input!==undefined?'in '+fmtCredits(p.input):'')+(p.input!==undefined&&p.output!==undefined?' · ':'')+(p.output!==undefined?'out '+fmtCredits(p.output):'')+' credits per M tokens';
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
      if(estimate!==undefined&&estimate>headroom)reasons.push({code:'over-headroom',text:'Reading this conversation once could use about '+fmtCredits(estimate)+' credits (estimate); '+fmtCredits(headroom)+' are left under the cap.'});
    }
    const win=windowOf(tgt,tierTo);
    const compaction=win>0&&nn(ctx.tokens)&&ctx.tokens>win;
    if(compaction)reasons.push({code:'smaller-window',text:'The context in use ('+fmtTokens(ctx.tokens)+' tokens) is larger than the window of '+name+' ('+fmtTokens(win)+'). It is compacted first, which costs one model call.'});
    return {needed:reasons.length>0,direction:rel.direction,reasons,estimate,headroom,relative:rel,compaction,overCap:reasons.some(r=>r.code==='over-headroom')};
  }

  /* Suggest a fresh session near the limit (spec 030 FR-013): at 90% or more, after a compaction already ran (or failed), or at once when the
     agent cannot compact; only while idle, and never again once the user dismissed the note. */
  function suggestFresh(s){
    s=s||{};
    if(s.dismissed||!s.idle||!(s.percent>=90))return false;
    if(s.canCompact===false)return true;
    return (s.compactions>0)||s.lastCompactionFailed===true;
  }

  const TRIGGER={auto:'automatic','model-switch':'before the model switch',manual:'manual',overflow:'after the window was exceeded'};
  /* The one line a compaction leaves in the chat. Plain text (the caller escapes it). */
  function compactionText(e){
    if(!e)return '';
    const how=TRIGGER[e.trigger]||'automatic';
    if(e.phase==='start')return 'Compacting the context ('+how+')…';
    if(e.phase==='failed')return 'Compaction failed'+(e.error?': '+String(e.error).slice(0,200):'')+'. The conversation is unchanged.';
    const span=nn(e.tokensBefore)&&nn(e.tokensAfter)?': '+fmtTokens(e.tokensBefore)+' → '+fmtTokens(e.tokensAfter)+' tokens':nn(e.tokensRemoved)?': '+fmtTokens(e.tokensRemoved)+' tokens removed':'';
    return 'Context compacted ('+how+')'+span+'.';
  }
  const CAUSE={'rate-limit':'because of a rate limit','fallback':'because the request was refused','runtime':'by the runtime','resume':'when the session resumed'};
  /* The line for a model change: ours says what happened; one the runtime made says so plainly (spec 030 FR-015). */
  function modelChangeText(e,nameOf){
    if(!e)return '';
    const nm=nameOf||(x=>x);
    const to=nm(e.model),from=e.previousModel?nm(e.previousModel):'';
    if(e.cause==='user')return 'Model set to '+to+(e.tier==='long'?' (long context)':'')+'. The next message uses it.';
    return 'The runtime changed the model'+(from?' from '+from:'')+' to '+to+' '+(CAUSE[e.cause]||CAUSE.runtime)+'. The next message uses it.';
  }

  return {pricingFromBatch,priceOf,windowOf,hasLong,relativePrice,estimateInputCredits,confirmFor,suggestFresh,compactionText,modelChangeText,fmtCredits,fmtRatio,fmtTokens,priceLine,hasPrice};
})());
