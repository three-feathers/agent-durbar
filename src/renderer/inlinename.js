/* Rename in place (spec 059 FR-020..FR-025, issue #636): one field over a name, for the chat header, desk cards, list rows, Previous
   sessions rows and folder names. Plain script: in the page window.DurbarInlineName; in Node (tests) module.exports.
   Two parts. The PURE part has no DOM and is unit-tested (scripts/test-inlinename.ts): keyAction, pasteText, outcome, blurAction.
   The DOM part (open, follow, close, current) draws ONE <input> in a layer on document.body, over the name's box. It is never inside the
   card, row or heading: the office morphs, the list is rebuilt on every status tick and repaintName rewrites the name, and none of that
   may remove the field or its text (FR-023 item 5). What happens on save is not here: the caller passes `submit(text)`, which is the
   existing submit part of the Rename dialog (FR-022), so the dialog and the field cannot drift. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarInlineName=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';

  /* ---------------- pure part ---------------- */

  /* What a key does inside the open field: 'save' (Enter), 'cancel' (Escape), 'tab' (Tab, Shift+Tab: save like blur, focus goes back),
     or null (anything else, and every key during an IME composition: Enter then only commits the composition, FR-021 item 6). */
  function keyAction(e){
    if(!e||e.isComposing||e.keyCode===229)return null;
    if(e.key==='Enter')return 'save';
    if(e.key==='Escape'||e.key==='Esc')return 'cancel';
    if(e.key==='Tab')return 'tab';
    return null;
  }
  /* Does this key start an edit on a focused title, card, row or door? F2 anywhere; Enter only when `allowEnter` (the chat title, D1). */
  function startsEdit(e,allowEnter){
    if(!e||e.isComposing||e.keyCode===229||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return false;
    return e.key==='F2'||(!!allowEnter&&e.key==='Enter');
  }
  /* Pasted line breaks and tabs become one space each, so "a\nb" does not glue into "ab" in a single-line field (FR-021 item 7).
     Anything else (U+2028, hidden characters) is left to the rule, which refuses it with its reason. */
  function pasteText(s){return String(s==null?'':s).replace(/\r\n|\r|\n|\t/g,' ');}
  /* Same collapse as the stored name (cleanDisplayName): runs of white space become one space, ends trimmed. */
  const norm=s=>String(s==null?'':s).replace(/\s+/g,' ').trim();
  /* What the typed text means against what was prefilled: 'same' (no call, FR-021 item 5), 'reset' (empty: the default name comes
     back, item 8) or 'save'. 'same' wins over 'reset': an unnamed session whose field is left alone stays unnamed. */
  function outcome(prefill,text){
    const t=norm(text);
    if(t===norm(prefill))return 'same';
    return t===''?'reset':'save';
  }
  /* Focus left the field. 'keep': the whole window lost focus, the field stays (FR-021 item 2). 'revert': the text breaks the rule, the
     old name comes back with a toast. 'save' otherwise. */
  function blurAction(windowHasFocus,ruleError){
    if(!windowHasFocus)return 'keep';
    return ruleError?'revert':'save';
  }

  /* ---------------- DOM part ---------------- */

  let cur=null; /* the one open edit (FR-021 item 10) */
  let seq=0;

  const focusEl=(el)=>{
    if(!el||typeof el.focus!=='function')return;
    if(typeof window!=='undefined'&&window.DurbarScroll&&window.DurbarScroll.focus)window.DurbarScroll.focus(el);
    else el.focus({preventScroll:true});
  };

  /* Open the field over `anchor` (the name's element).
     o.doc          the document
     o.anchor       the element whose box the field covers
     o.value        the prefill (the current display name)
     o.max          maxlength
     o.label        aria-label of the field
     o.hint         sr-only help, linked with aria-describedby
     o.key          a string that names what is being edited (data-id, door, prev key), for drivers
     o.check(text)  the rule's reason for this text, or '' (the dialog's pre-check)
     o.submit(text) the existing save; resolves {ok:boolean, reason?:string}; `reason` = a rule refusal (stay open on Enter)
     o.notify(msg)  a toast line (blur save refused)
     o.reanchor()   the current name element for this edit: an Element, null (not on screen: save as blur does) or 'gone'
                    (the item left the window: close without saving)
     o.clip()       an element whose inner box the field may not leave and may fill (the card, the row); optional
     o.fill         false: do not widen the field to the clip's free width
     o.maxWidth     the widest the field gets (default 480)
     o.grow         false: no extra height over a short name box (a Previous sessions row: the date line is just under it)
     o.focusBack()  the control to focus after Enter, Escape and Tab (found again by its key); optional
     o.onClose(how) how: 'saved' | 'same' | 'cancel' | 'gone' | 'blur' */
  function open(o){
    const doc=o.doc||document;
    if(cur){cur.commit('switch');if(cur)cur.close('switch');} /* starting another edit saves the open one, as blur does; one still saving (Enter in flight) just loses its field: its answer must not take focus back from the new one */
    const id=++seq;
    const layer=doc.createElement('div');layer.className='inl-layer';layer.dataset.inl='1';
    const input=doc.createElement('input');input.type='text';input.className='inl-input';input.autocomplete='off';input.spellcheck=false;
    input.maxLength=o.max||60;input.value=o.value||'';input.tabIndex=-1;
    input.setAttribute('aria-label',o.label||'Name');
    const hint=doc.createElement('span');hint.className='sr-only';hint.id='inlHint'+id;hint.textContent=o.hint||'';
    const err=doc.createElement('p');err.className='inl-err';err.id='inlErr'+id;err.setAttribute('role','alert');err.hidden=true;
    input.setAttribute('aria-describedby',hint.id+' '+err.id);
    layer.append(input,hint,err);doc.body.appendChild(layer);

    const st={input,layer,errText:'',busy:false,closed:false,prefill:o.value||'',key:o.key||'',anchor:o.anchor};
    const self={
      get state(){return {open:!st.closed,value:input.value,anchorKey:st.key,error:st.errText,busy:st.busy};},
      commit,cancel,place,close:(how)=>finish(how||'gone',false),el:input,
    };

    const setError=t=>{st.errText=t||'';err.textContent=st.errText;err.hidden=!st.errText;if(st.errText)input.setAttribute('aria-invalid','true');else input.removeAttribute('aria-invalid');};
    function finish(how,refocus){
      if(st.closed)return;st.closed=true;
      input.removeEventListener('keydown',onKey);input.removeEventListener('blur',onBlur);input.removeEventListener('paste',onPaste);input.removeEventListener('input',onInput);
      layer.remove();const wasCur=cur===self;if(wasCur)cur=null;
      if(refocus&&wasCur&&o.focusBack)focusEl(o.focusBack());
      if(o.onClose)o.onClose(how);
    }
    /* position the layer over the name; false when the anchor has no box (not on screen) */
    function place(el){
      const a=el||st.anchor; if(!a||!a.getBoundingClientRect)return false;
      const r=a.getBoundingClientRect(); if(!r.width&&!r.height)return false;
      st.anchor=a;
      const win=doc.defaultView||window, cs=win.getComputedStyle(a);
      const vw=(doc.documentElement&&doc.documentElement.clientWidth)||win.innerWidth||1024;
      const clip=o.clip&&o.clip(); const cr=clip&&clip.getBoundingClientRect?clip.getBoundingClientRect():null;
      const maxRight=Math.min(vw-4,cr&&cr.width?cr.right:vw-4);
      const left=Math.max(2,r.left);
      let w=Math.max(r.width,120);
      if(cr&&cr.width&&o.fill!==false)w=Math.max(w,Math.min(cr.right-4-left,o.maxWidth||480)); /* up to the item's free inner width, so a normal name is readable (FR-025) */
      if(left+w>maxRight)w=Math.max(60,maxRight-left);
      /* the field covers the name's box; a short box (a 12px line) gets a few pixels more so the text is not cut, over the neighbours only (nothing moves) */
      const fs=parseFloat(cs.fontSize)||13, h=Math.max(r.height,o.grow===false?Math.round(fs*1.15)+3:Math.round(fs*1.4)+6);
      layer.style.left=left+'px';layer.style.top=(r.top-(h-r.height)/2)+'px';layer.style.width=w+'px';
      input.style.height=h+'px';
      input.style.fontSize=cs.fontSize;input.style.fontWeight=cs.fontWeight;input.style.fontFamily=cs.fontFamily;input.style.lineHeight=cs.lineHeight;input.style.letterSpacing=cs.letterSpacing;
      return true;
    }
    async function commit(how){
      if(st.closed||st.busy)return;
      const text=input.value, oc=outcome(st.prefill,text);
      const quiet=how==='blur'||how==='switch'||how==='follow';
      if(oc==='same'){finish('same',how==='enter'||how==='tab');return;}
      const reason=(oc==='reset'?'':(o.check?o.check(text):''));
      if(reason){
        if(how==='enter'){setError(reason);focusEl(input);return;}
        const msg='Not renamed: '+reason; /* a blur or Tab with a rule breaker: the old name comes back */
        finish('cancel',how==='tab'); if(o.notify)o.notify(msg); return;
      }
      st.busy=true;input.readOnly=true;input.setAttribute('aria-busy','true');setError('');
      if(quiet)finish('blur',false); /* the click that moved focus already went elsewhere: do not wait, do not steal focus */
      let res;
      try{res=await o.submit(oc==='reset'?'':norm(text));}catch(e){res={ok:false};}
      if(quiet){if(res&&res.reason&&o.notify)o.notify('Not renamed: '+res.reason);return;}
      st.busy=false;input.readOnly=false;input.removeAttribute('aria-busy');
      if(st.closed){if(res&&res.reason&&o.notify)o.notify('Not renamed: '+res.reason);return;} /* its field was replaced while it saved */
      if(res&&res.reason){setError(res.reason);focusEl(input);return;}
      finish('saved',true);
    }
    function cancel(){if(st.closed)return;finish('cancel',true);}
    function onKey(e){
      e.stopPropagation(); /* nothing reaches the global handler: Esc must not close the chat, the Folders panel or the inbox */
      if(st.busy){if(e.key==='Enter'||e.key==='Tab')e.preventDefault();return;}
      const act=keyAction(e); if(!act)return;
      e.preventDefault();
      if(act==='save')commit('enter');
      else if(act==='cancel')cancel();
      else commit('tab');
    }
    function onBlur(){
      if(st.closed||st.busy)return;
      const rule=o.check&&outcome(st.prefill,input.value)==='save'?o.check(input.value):'';
      const act=blurAction(typeof doc.hasFocus==='function'?doc.hasFocus():true,rule);
      if(act==='keep')return; /* the window lost focus: the field stays and gets focus back with the window */
      commit('blur');
    }
    function onPaste(e){
      const cd=e.clipboardData; if(!cd)return;
      const t=cd.getData('text/plain'); if(!/[\r\n\t]/.test(t))return;
      e.preventDefault();
      const s=input.selectionStart==null?input.value.length:input.selectionStart, en=input.selectionEnd==null?s:input.selectionEnd;
      input.setRangeText(pasteText(t),s,en,'end');
    }
    function onInput(){if(st.errText)setError('');}
    input.addEventListener('keydown',onKey);input.addEventListener('blur',onBlur);input.addEventListener('paste',onPaste);input.addEventListener('input',onInput);
    cur=self;
    place(o.anchor);
    focusEl(input);
    if(typeof input.select==='function')input.select();
    self.follow=()=>{
      if(st.closed)return;
      const a=o.reanchor?o.reanchor():st.anchor;
      if(a==='gone'){finish('gone',false);return;}
      if(!a||!place(a)){commit('follow');return;}
    };
    return self;
  }

  /* Called by the app at the end of every render, on resize and on the floor's scroll (FR-023 item 5). */
  function follow(){if(cur&&cur.follow)cur.follow();}
  function close(how){if(cur)cur.close(how||'gone');}
  function current(){return cur?cur.state:{open:false,value:'',anchorKey:'',error:'',busy:false};}
  /* Save the open edit, as blur does (a dialog opens over it, FR-023 item 6; a second edit starts). */
  function saveOpen(){if(cur)cur.commit('switch');}

  return {keyAction,startsEdit,pasteText,outcome,blurAction,open,follow,close,current,saveOpen};
})());
