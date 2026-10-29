/* "New": a finished agent's reply that nobody has seen yet (spec 001 FR-170..FR-177, spec 005 FR-176, FR-177, issue #691). Pure: no DOM, no
   timers. In the page: window.DurbarUnread; in Node: module.exports.
   Unread is a marker kept beside an agent's state, never a state: nothing here knows Done, Working or the counts. The page asks `create()` for
   a tracker and tells it three things: a turn completed (and whether the chat was shown), the chat was shown, the person marked it read. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarUnread=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  /* Spec 005 FR-176: the chat of agent `id` is shown when the panel is open on it, the window is visible, the Chat tab is in front (not
     Browser) and the Notes drawer is closed. `s` = {selected, panelOpen, visible, tab, notesOpen}. */
  function isShown(id,s){
    if(!s||id==null||id==='')return false;
    return s.panelOpen===true&&s.selected===id&&s.visible===true&&(s.tab==null||s.tab==='chat')&&s.notesOpen!==true;
  }
  function create(){
    const set=new Set();
    return {
      /* a turn ended. `shown`: the chat was shown at that moment. Returns 'seen' (shown: the reply is read, any older marker goes too),
         'marked' (newly unread: announce once) or 'already' (it was unread and still is: no second alert) */
      complete(id,shown){
        if(id==null||id==='')return 'seen';
        if(shown){set.delete(id);return 'seen';}
        if(set.has(id))return 'already';
        set.add(id);return 'marked';
      },
      /* the chat is shown, or the person said "mark as read". Returns true when a marker was cleared. */
      read(id){return set.delete(id);},
      /* the session went away */
      forget(id){set.delete(id);},
      has(id){return set.has(id);},
      ids(){return [...set];},
      get size(){return set.size;},
    };
  }
  return {isShown,create};
})());
