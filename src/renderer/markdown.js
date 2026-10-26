/* Safe Markdown for the chat (spec 016). marked parses, DOMPurify sanitises; both are bundled locally (dist/renderer/vendor).
   Plain script: in the page it defines window.DurbarMD; in Node (tests) `require` gives create(marked, DOMPurify). */
(function(root, factory){
  if(typeof module==='object'&&module.exports) module.exports=factory;
  else root.DurbarMD=factory(root.marked, root.DOMPurify);
})(typeof self!=='undefined'?self:this, function create(markedLib, purify){
  'use strict';
  const MAX_CHARS=200000;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const md=new markedLib.Marked({gfm:true,breaks:false,async:false});
  md.use({renderer:{
    /* raw HTML in a message is shown as text, never parsed as markup */
    html(tok){return esc(tok.text!==undefined?tok.text:tok.raw||'');},
    /* images are never loaded: show a quiet text stand-in (the sanitiser would drop <img> anyway) */
    image(tok){return '<em class="md-img">[image'+(tok.text?': '+esc(tok.text):'')+']</em>';}
  }});
  const CFG={
    ALLOWED_TAGS:['p','br','hr','strong','b','em','i','del','s','code','pre','blockquote','ul','ol','li','h1','h2','h3','h4','h5','h6','a','table','thead','tbody','tr','th','td'],
    ALLOWED_ATTR:['href','title','align'],
    ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false,
    ALLOWED_URI_REGEXP:/^(?:https?:\/\/|mailto:)/i,
    FORBID_TAGS:['style','script','img','svg','math','iframe','object','embed','form','input','button','video','audio','source','link','meta','base'],
    KEEP_CONTENT:true
  };
  /* the simulator only (spec 080 FR-091): its test pages, so a simulated agent can print a link to one; never set in the app */
  let simLinks=false;
  const OK_HREF=()=>simLinks?/^(?:https?:\/\/|mailto:|durbar-sim:\/\/pages\/)/i:/^(?:https?:\/\/|mailto:)/i;
  function allowSimLinks(){simLinks=true;CFG.ALLOWED_URI_REGEXP=/^(?:https?:\/\/|mailto:|durbar-sim:\/\/pages\/)/i;}
  purify.addHook('afterSanitizeAttributes',function(node){
    if(node.tagName==='A'){
      const h=node.getAttribute('href')||'';
      /* http(s) and mailto: keep their href (spec 080 FR-024: a click is classified in main; only a mail link may ask to open another app). Any other scheme loses it. */
      if(!OK_HREF().test(h))node.removeAttribute('href');
      else{node.setAttribute('rel','noopener noreferrer');node.setAttribute('target','_blank');}
    }
  });
  function render(text){
    let s=String(text==null?'':text), cut=false;
    if(s.length>MAX_CHARS){s=s.slice(0,MAX_CHARS);cut=true;}
    let html;
    try{html=md.parse(s);}catch(e){html='<p>'+esc(s)+'</p>';}
    html=purify.sanitize(html,CFG);
    if(cut)html+='<p><em>(Message cut for display: it is longer than '+(MAX_CHARS/1000)+' kB.)</em></p>';
    return html;
  }
  return {render,MAX_CHARS,allowSimLinks};
});
