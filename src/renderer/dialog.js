/* Small confirmation dialog (spec 003 FR-033, spec 018). Plain script: in the page it defines window.DurbarDialog;
   in Node (tests) `require` gives the same factory. DurbarDialog(document) returns askDialog(opts).
   askDialog({title,body,lines:[text],input:{label,placeholder,max,value,focus,select,error,submitOnEnter,check,multiline},buttons:[{label,value,cls}],check:{label,checked},returnFocus}) resolves {value,checked,text[,picked]} for a
   button (`text` = the optional input's value, `lines` = a short list under the body; `size` 'm' or 'l' picks the wider dialog widths, default S (spec 052 FR-167); all set with textContent, never HTML), or null when dismissed (Cancel button with value null, Escape, click on the backdrop).
   Spec 099: `custom` {node, value(), valid(), onChange}: a form of its own above the buttons; the primary button follows `valid`; the result carries `custom`: its value.
   Spec 064: `input.multiline` (a textarea), `picks:[{label,note,value,checked,disabled}]` (a checkbox list, result `picked`: the chosen values),
   `need:{text,picks,label(n)}` (the primary button stays disabled until met; `label` names it from the count).
   `input.hint`: a 12px note under the field (the label stays one short line, spec 052 FR-170). `input.submitOnEnter`: Enter in the field presses the primary button unless `need` keeps it disabled; never from a textarea (Escape still cancels). `input.check(text)` returns an error line or '': when
   it returns one, the confirming buttons do not close the dialog; the line shows under the field (role=alert, linked with aria-describedby) and focus stays in the field (spec 059 FR-004).
   Keyboard contract: focus goes into the dialog when it opens and cannot leave it (Tab and Shift+Tab wrap; anything that
   steals focus is undone); Escape dismisses it (never confirms); when it closes focus goes back to `returnFocus` (an element
   or a function returning one), by default the element that had focus when it opened. Confirming is only ever an explicit
   activation of a button, so a dialog that asks for confirmation (Allow all) is never weakened by the keyboard handling. */
/* Spec 081 FR-013: the words of the "End all sessions?" dialog, shared with the update dialog (Settings > Agent apps) so both say the same. */
function endAllBody(n,busyN){
  return (n===1?'1 session ends':n+' sessions end')+' and frees '+(n===1?'its place':'their places')+(busyN?' ('+busyN+' still working: '+(busyN===1?'its reply stops':'their replies stop')+')':'')+'. The chats stay; send a message to pick up where you left off.';
}
/* Spec 052 FR-237 (owner bug report 2026-11-03): a press that starts in a text field and ends outside its popup (a drag that selects
   the text and overshoots, a triple-click that moves) must not close the popup. The browser sends that click to the nearest element that
   holds both ends, so a backdrop or a click-outside listener used to read it as a click outside. The one place that knows where the press
   started: a capture listener on the document records the primary press's down and up targets; a click within a second of that up comes
   from it (a click from the keyboard or a script has no fresh press, and then only its target counts, as before). */
const DURBAR_PRESS=(function(){
  const PRESS={down:null,up:null,upT:-1e9};
  function trackPress(doc){
    if(!doc||typeof doc.addEventListener!=='function'||doc.__durbarPress)return;
    doc.__durbarPress=true;
    const prim=e=>e.button===undefined||e.button===0;
    const down=e=>{if(prim(e)){PRESS.down=e.target;PRESS.up=null;}};
    const up=e=>{if(prim(e)){PRESS.up=e.target;PRESS.upT=e.timeStamp||0;}};
    doc.addEventListener('pointerdown',down,true);doc.addEventListener('mousedown',down,true);
    doc.addEventListener('pointerup',up,true);doc.addEventListener('mouseup',up,true);
  }
  /* the press behind this click, {down, up}, or null when it has none (keyboard, script, a stale press) */
  function pressOf(e){
    if(!e||!PRESS.up||Math.abs((e.timeStamp||0)-PRESS.upT)>1000)return null;
    return {down:PRESS.down,up:PRESS.up};
  }
  /* a click on the backdrop `ov` itself that may close its dialog: the press started and ended on the backdrop */
  function isBackdropClick(e,ov){
    if(!e||e.target!==ov)return false;
    const p=pressOf(e); return !p||(p.down===ov&&p.up===ov);
  }
  /* close a dialog on a click on its backdrop, never on a drag that only ends there */
  function onBackdrop(ov,fn){trackPress(ov.ownerDocument);ov.addEventListener('click',e=>{if(isBackdropClick(e,ov))fn(e);});}
  /* a click outside every element of `roots` that may close a popover: its target is outside them and, for a pointer press, the press
     started outside them too (a caller whose popover hosts the rename-in-place field passes that field's layer as a root) */
  function isOutsideClick(e,roots){
    const inAny=n=>!!n&&roots.some(r=>r&&typeof r.contains==='function'&&r.contains(n));
    if(!e||inAny(e.target))return false;
    const p=pressOf(e); return !p||!inAny(p.down);
  }
  if(typeof document!=='undefined')trackPress(document);
  return {trackPress,pressOf,isBackdropClick,onBackdrop,isOutsideClick};
})();
(function(root,factory){
  factory.endAllBody=endAllBody;
  Object.assign(factory,DURBAR_PRESS);
  if(typeof module==='object'&&module.exports) module.exports=factory;
  else root.DurbarDialog=factory;
})(typeof self!=='undefined'?self:this, function create(doc){
  'use strict';
  const focusIn=(el,o)=>{if(typeof window!=='undefined'&&window.DurbarScroll)window.DurbarScroll.focus(el,o);else if(el&&typeof el.focus==='function')el.focus({preventScroll:true});}; /* spec 052 FR-176: focus never scrolls the page (innerscroll.js, looked up at call time: this file may load first, or run in Node tests) */
  const FOCUSABLE='button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';
  return function askDialog({title,body,lines,input,buttons,check,picks,need,returnFocus,size,custom,overlayClass,role,label,auto}){
    return new Promise(resolve=>{
      const old=doc.getElementById('modeDlg');if(old)old.remove();
      const opener=returnFocus||(doc.activeElement&&doc.activeElement!==doc.body?doc.activeElement:null);
      const d=doc.createElement('div');d.id='modeDlg';d.className='dlg-ov';
      d.innerHTML=`<div class="dlg${size==='m'||size==='l'?' '+size:''}" role="alertdialog" aria-modal="true" aria-labelledby="mdT" aria-describedby="mdB mdL"><h3 id="mdT"></h3><p class="dsub" id="mdB"></p>${lines&&lines.length?'<ul class="dlist" id="mdL"></ul>':''}${input?'<label class="dinput"><span></span>'+(input.multiline?'<textarea id="mdIn" rows="4" spellcheck="true"></textarea>':'<input type="text" id="mdIn" autocomplete="off" spellcheck="false">')+'</label>'+(input.hint?'<small class="dhint" id="mdH"></small>':'')+'<p class="derr" id="mdErr" hidden></p>':''}${picks&&picks.length?'<fieldset class="dpicks" id="mdP"><legend class="sr-only">Choose</legend></fieldset>':''}${check?'<label class="chk"><input type="checkbox" id="mdChk"><span></span></label>':''}<div class="dbtn"></div></div>`;
      /* spec 052 FR-239, FR-240 (the Auto-follow notice): `overlayClass` adds classes to the backdrop; `role:'dialog'` with `label` names the dialog
         by `label` and drops aria-describedby (the caller says the text once with announce(), so a screen reader does not read it again) */
      if(overlayClass)String(overlayClass).split(/\s+/).filter(Boolean).forEach(c=>d.classList.add(c));
      if(role==='dialog'){const b=d.querySelector('.dlg');b.setAttribute('role','dialog');b.removeAttribute('aria-describedby');if(label){b.removeAttribute('aria-labelledby');b.setAttribute('aria-label',String(label));}}
      d.querySelector('#mdT').textContent=title;d.querySelector('#mdB').textContent=body;
      if(lines&&lines.length)lines.forEach(t=>{const li=doc.createElement('li');li.textContent=t;d.querySelector('#mdL').appendChild(li);});
      if(input){d.querySelector('.dinput span').textContent=input.label||'';if(input.hint){d.querySelector('#mdH').textContent=input.hint;d.querySelector('#mdIn').setAttribute('aria-describedby','mdH');}const inp=d.querySelector('#mdIn');inp.placeholder=input.placeholder||'';inp.maxLength=input.max||200;inp.value=input.value||'';}
      if(check){d.querySelector('.chk span').textContent=check.label;d.querySelector('#mdChk').checked=!!check.checked;}
      /* spec 064 FR-002: a checkbox list (label, a muted note, disabled with its reason); text only, never HTML */
      if(picks&&picks.length)picks.forEach((p,i)=>{const l=doc.createElement('label');l.className='dpick'+(p.disabled?' is-off':'');const cb=doc.createElement('input');cb.type='checkbox';cb.value=String(i);cb.checked=!!p.checked&&!p.disabled;cb.disabled=!!p.disabled;const t=doc.createElement('span');t.className='dpick-t';t.textContent=p.label;t.title=p.label;l.append(cb,t);if(p.note){const n=doc.createElement('small');n.textContent=p.note;l.appendChild(n);}d.querySelector('#mdP').appendChild(l);});
      const pickedOf=()=>picks?[...d.querySelectorAll('#mdP input:checked')].map(cb=>picks[Number(cb.value)].value):undefined;
      const row=d.querySelector('.dbtn');
      const items=()=>[...d.querySelectorAll(FOCUSABLE)];
      /* spec 052 FR-036: when the confirming choice is destructive (danger/warn), focus starts on Cancel, so Enter never confirms it unread */
      const first=()=>{const p=row.querySelector('.primary');if(p&&/\b(danger|warn)\b/.test(p.className)){const c=row.querySelector('[data-cancel]');if(c)return c;}return p&&!p.disabled?p:row.querySelector('[data-cancel]')||row.lastElementChild;};
      let closed=false,stopAuto=null;
      const done=v=>{
        if(closed)return;closed=true;
        if(typeof stopAuto==='function'){try{stopAuto();}catch(e){}}
        doc.removeEventListener('keydown',onKey,true);doc.removeEventListener('focusin',onFocusIn,true);
        /* spec 052 FR-239 (review on #1414): focus goes back only from a dialog that still holds it (or from nowhere): a dialog another one replaced
           (removed from the page) must not pull the focus out of the new one */
        const ae=doc.activeElement, held=!ae||ae===doc.body||d.contains(ae);
        d.remove();
        const t=typeof opener==='function'?opener():opener;
        if(held&&t&&typeof t.focus==='function'&&doc.contains(t))focusIn(t);
        resolve(v);
      };
      const textOf=()=>input?d.querySelector('#mdIn').value:undefined;
      /* while open: Escape cancels, Tab wraps. On the document in the capture phase, so it also works when focus slipped out. */
      const onKey=e=>{
        if(e.key==='Enter'&&input&&input.submitOnEnter&&!input.multiline&&e.target&&e.target.id==='mdIn'&&!e.isComposing){const p=row.querySelector('.primary');if(p){e.preventDefault();if(!p.disabled)p.click();return;}}
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();done(null);return;}
        if(e.key!=='Tab')return;
        const it=items();if(!it.length)return;
        const i=it.indexOf(doc.activeElement);
        if(i<0){e.preventDefault();focusIn(it[e.shiftKey?it.length-1:0]);}
        else if(e.shiftKey&&i===0){e.preventDefault();focusIn(it[it.length-1]);}
        else if(!e.shiftKey&&i===it.length-1){e.preventDefault();focusIn(it[0]);}
      };
      /* focus must not leave the dialog (a stray focus() on the control behind it, a click on the backdrop) */
      /* FR-237: back to the control that had the focus inside (the field keeps its text and selection), not to the first button */
      let lastIn=null;
      const onFocusIn=e=>{if(d.contains(e.target)){lastIn=e.target;return;}const f=lastIn&&d.contains(lastIn)?lastIn:first();if(f)focusIn(f);};
      buttons.forEach(b=>{const el=doc.createElement('button');el.type='button';el.className='btn'+(b.cls?' '+b.cls:'');el.textContent=b.label;if(b.value===null)el.dataset.cancel='1';el.onclick=()=>{
        if(el.disabled)return;
        if(b.value!==null&&input&&typeof input.check==='function'){
          const msg=input.check(textOf());const er=d.querySelector('#mdErr'),inp=d.querySelector('#mdIn');
          if(msg){er.textContent=msg;er.hidden=false;er.setAttribute('role','alert');inp.setAttribute('aria-invalid','true');inp.setAttribute('aria-describedby','mdErr');focusIn(inp);return;}
        }
        done(b.value===null?null:Object.assign({value:b.value,checked:check?d.querySelector('#mdChk').checked:false},input?{text:textOf()}:{},picks?{picked:pickedOf()}:{},custom?{custom:custom.value()}:{}));
      };row.appendChild(el);});
      /* spec 064 FR-002: the primary button stays disabled until the text and the number of picks it needs are there */
      if(need){const p=row.querySelector('.primary');const check2=()=>{if(!p)return;const okText=!need.text||String(textOf()||'').trim().length>0;const okPicks=!need.picks||(pickedOf()||[]).length>=need.picks;p.disabled=!(okText&&okPicks);if(need.label)p.textContent=need.label((pickedOf()||[]).length);};d.addEventListener('input',check2);d.addEventListener('change',check2);check2();}
      if(custom){row.parentNode.insertBefore(custom.node,row);const p=row.querySelector('.primary');custom.onChange=v=>{if(p)p.disabled=!v;};if(p)p.disabled=!custom.valid();}
      DURBAR_PRESS.onBackdrop(d,()=>done(null)); /* FR-237: a drag from the field that ends on the backdrop keeps the dialog */
      doc.addEventListener('keydown',onKey,true);doc.addEventListener('focusin',onFocusIn,true);
      doc.body.appendChild(d);
      focusIn(input&&input.focus?d.querySelector('#mdIn'):first());
      /* spec 052 FR-239: a dialog that closes by itself. `auto(close, el)` runs once the dialog is in the page; close(value) resolves {value} as a
         button would (focus goes back the same way); what it returns, a function, runs on every close (a button, Escape, the backdrop, close) */
      if(typeof auto==='function')stopAuto=auto(v=>done({value:v}),d);
      if(input&&input.error){const er=d.querySelector('#mdErr'),inp=d.querySelector('#mdIn');er.textContent=input.error;er.hidden=false;er.setAttribute('role','alert');inp.setAttribute('aria-invalid','true');inp.setAttribute('aria-describedby','mdErr');} /* a reason from the caller (main refused the text) */
      if(input&&input.select)d.querySelector('#mdIn').select(); /* spec 059: the prefilled text starts selected, so typing replaces it */ /* input.focus: start in the text field (rename) */
    });
  };
});
