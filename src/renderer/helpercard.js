/* The text of an expanded helper card on the office floor (spec 001 FR-089..FR-093, FR-097, issue 697). Pure: no DOM. In the page:
   window.DurbarHelperCard; in Node (tests): module.exports.

   A helper whose parent has room is drawn as a card with labelled lines (Task, Now, Result, Failed, facts) instead of a name-and-status
   tile. This module decides WHICH lines a helper shows and what they say; app.js draws them. The rules:
   - Every agent-written field (task, activity, result, error, model, name) is masked on the raw text FIRST, then made plain, then cut
     to HX_CHARS, by the page's one path (DurbarSafeText, injected as `deps`). The text, the title and the aria-label all use that same cut
     value, so a field is never longer in an attribute than on the card, and the CSS only hides whole lines of text that is already cut.
   - Fails closed: with no working mask a field that has text shows Durbar's own word for it ("Finished.", "Failed.", ...), never the text.
   - A field the agent app did not send reads "Task not reported" / "Result not reported" / "No activity reported yet", with the tooltip
     "The agent app did not send this." It is never filled with another field (a task is never shown as a result) or with invented words.
   - Masked once per field change: the cut lines are kept per helper, field and raw value, so a repaint with unchanged fields masks nothing.
   - The tooltip is built from the already masked, cut parts and then cut to HX_TIP (the number the desk card's tooltip uses).
   deps: { excerpt(text, n, fallback) masked+plain+cut, mask(text) masked, toolLabel(tool, label, n) masked and cut ('' when masking is
   not possible), plain(kind, tool, label, running) the plain chat words of Simple, cut(text, n), fmtTok(n) }. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarHelperCard=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const HX_MIN_F=1.4;   /* parent desks stay at least this grown for helper detail (owner decision 1, 2026-10-25) */
  const HX_CHARS=240;   /* the one per-field cap, end to end (text, title, aria-label) */
  const HX_TIP=200;     /* the tooltip cut, the number deskTip uses */
  const NR_TIP='The agent app did not send this.';
  const NAME_MAX=60;
  /* level -> its shape: whole text lines per part, the minimum card width (px) for ~85 characters at most per line, the fixed height */
  const HX_LEVELS={1:{task:0,body:1,minW:220},2:{task:2,body:2,minW:260}};
  const HX_MAX_W=460;
  /* Durbar's own words when masking is not possible (fail closed), and when the agent app sent nothing */
  const SAFE_WORD={task:'Task hidden.',now:'Working.',result:'Finished.',failed:'Failed.'};
  const NOT_REPORTED={task:'Task not reported',now:'No activity reported yet',result:'Result not reported',failed:'Error not reported'};
  const LABEL={task:'Task',now:'Now',result:'Result',failed:'Failed'};

  function create(deps){
    const D=deps||{};
    /* every dependency answers a string or nothing: a throwing one, or one that answers something else, is an empty answer (fail closed) */
    const wrap=f=>typeof f==='function'?(...a)=>{try{const r=f(...a);return typeof r==='string'?r:'';}catch(e){return '';}}:()=>'';
    const excerpt=wrap(D.excerpt), mask=wrap(D.mask), toolLabel=wrap(D.toolLabel), plain=wrap(D.plain), cut0=wrap(D.cut);
    const cut=(t,n)=>cut0(t,n)||(typeof D.cut==='function'?'':String(t).slice(0,n));
    const fmtTok=typeof D.fmtTok==='function'?D.fmtTok:n=>String(n);
    /* ---- the memo: per holder (the helper's record, else its card), field and raw value ---- */
    const memo=new WeakMap();
    function cached(holder,key,raw,fn){
      let m=memo.get(holder); if(!m){m=new Map();memo.set(holder,m);}
      const c=m.get(key); if(c&&c.raw===raw)return c.out;
      let out; try{out=fn();}catch(e){out='';}
      if(typeof out!=='string')out='';
      m.set(key,{raw,out}); return out;
    }
    const has=t=>t!=null&&String(t).trim()!=='';
    /* a text field: masked, plain, cut to HX_CHARS; Durbar's word when it has text and masking is not possible; null when not sent */
    function textField(holder,key,raw,word){
      if(!has(raw))return null;
      const s=String(raw);
      const out=cached(holder,key,s,()=>excerpt(s,HX_CHARS,''));
      return out||SAFE_WORD[word||key]||'';
    }
    /* what the helper does now: from its last activity (s.now), else null */
    function nowField(holder,now,simple){
      if(!now||typeof now!=='object')return null;
      if(now.kind==='thinking')return 'Thinking';
      if(now.kind==='intent')return textField(holder,'now:intent',now.text,'now');
      if(!has(now.tool))return null;
      const raw=[simple?'s':'e',now.kind||'',now.tool,now.label==null?'':now.label].join('\u0001');
      const out=cached(holder,'now:tool',raw,()=>{
        const tool=cut(mask(now.tool),40)||'tool', ml=has(now.label)?toolLabel(now.tool,now.label,HX_CHARS):'';
        if(simple)return plain(now.kind,now.tool,ml,true);
        return tool+(ml?' '+ml:'');
      });
      return out||SAFE_WORD.now;
    }
    function factsField(rec){
      if(!rec)return '';
      const p=[], model=textField(rec,'model',rec.model);
      if(model)p.push(model);
      const ms=Number(rec.durationMs); if(ms>0)p.push((ms/1000).toFixed(1)+'s');
      const tools=Number(rec.tools); if(tools>0)p.push(tools+' tool call'+(tools===1?'':'s'));
      const tok=Number(rec.tokens); if(tok>0)p.push(fmtTok(tok)+' tokens');
      return p.join(' · ');
    }
    const line=(key,text)=>text==null
      ? {key,label:'',text:NOT_REPORTED[key],reported:false,tip:NR_TIP}
      : {key,label:LABEL[key],text,reported:true,tip:''};
    /* h: { holder (a stable object for the memo when there is no record: the helper's card), name, parent, status: 'running'|'done'|'failed', word (Durbar's status word), sub: the record or null, task: the card's task line }
       o: { simple, live }. Returns { name, lines: [{key, label, text, reported, tip}], aria, title }. */
    function view(h,level,o){
      const lv=level===1?1:2, simple=!!(o&&o.simple), live=!(o&&o.live===false), rec=h.sub||null, holder=rec||h.holder||h;
      const st=h.status==='failed'?'failed':h.status==='done'?'done':'running';
      const task=rec?textField(rec,'task',rec.task):null;
      let now=null;
      if(st==='running'&&live){
        now=rec?nowField(rec,rec.now,simple):textField(holder,'now:line',h.task,'now'); /* a helper with no record (demo): its card line is its activity */
      }
      const end=st==='done'?line('result',rec?textField(rec,'result',has(rec.result)?rec.result:rec.lastFinal):null)
        :st==='failed'?line('failed',rec?textField(rec,'failed',rec.error):null):null;
      if(end&&end.reported&&end.key==='failed')end.text=end.text.replace(/^failed:?\s+/i,'')||end.text; /* the label says it: no "Failed Failed: ..." */
      const out=[];
      if(lv===1){
        if(st==='running'){
          if(live&&now!=null)out.push(line('now',now));
          else if(task!=null)out.push(line('task',task));
          else out.push(line(live?'now':'task',null));
        } else out.push(end);
      } else {
        out.push(line('task',task));
        if(st==='running'){ if(live)out.push(line('now',now)); } else out.push(end);
        const f=factsField(rec); if(f)out.push({key:'facts',label:'',text:f,reported:true,tip:''});
      }
      const name=cached(holder,'name',String(h.name==null?'':h.name),()=>cut(mask(h.name)||'Helper',NAME_MAX))||'Helper';
      const parts=out.map(l=>l.reported&&l.label?l.label+': '+l.text:l.text);
      const head=name+', helper of '+(h.parent||'its agent')+', '+(h.word||'');
      return {name,lines:out,aria:head+(parts.length?'. '+parts.join('. '):''),title:cut(name+' · '+(h.word||'')+(parts.length?' · '+parts.join(' · '):''),HX_TIP)};
    }
    /* the lines as markup; every agent-written character goes through `esc` (the page's escaper) */
    function html(v,esc){
      const e=typeof esc==='function'?esc:t=>String(t);
      return v.lines.map(l=>'<span class="hx-l hx-'+l.key+(l.reported?'':' hx-nr')+'"'+(l.tip?' title="'+e(l.tip)+'"':'')+'>'+(l.reported&&l.label?'<b>'+e(l.label)+'</b> ':'')+e(l.text)+'</span>').join('');
    }
    return {view,html};
  }
  return {HX_MIN_F,HX_CHARS,HX_TIP,HX_LEVELS,HX_MAX_W,NOT_REPORTED,NR_TIP,create};
})());
