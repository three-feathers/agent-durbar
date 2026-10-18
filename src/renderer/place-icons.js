/* Icons for the user's own places (spec 024 FR-018, FR-021): 12 generic line drawings in the office style (20x20, 1.5px stroke,
   currentColor; no brands). Strings only; the lobby and Settings put them in the page. Keep the ids in sync with CUSTOM_ICON_IDS in
   src/shared/places.ts (a test compares them). In the page: window.DurbarPlaceIcons; in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarPlaceIcons=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const svg=d=>'<svg class="pic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+d+'</svg>';
  /* id -> label for the picker, then the drawing */
  const LIST=[
    {id:'star',label:'Star',svg:svg('<path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/>')},
    {id:'flask',label:'Flask',svg:svg('<path d="M8 3h4M8.5 3v5.2L4 15.5a1.5 1.5 0 001.3 2.2h9.4a1.5 1.5 0 001.3-2.2L11.5 8.2V3M6.2 12.5h7.6"/>')},
    {id:'database',label:'Database',svg:svg('<ellipse cx="10" cy="5" rx="6" ry="2.5"/><path d="M4 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5"/>')},
    {id:'cloud',label:'Cloud',svg:svg('<path d="M5.5 15.5a3.5 3.5 0 01-.4-6.97A5 5 0 0114.7 7.6a3.9 3.9 0 01-.2 7.9z"/>')},
    {id:'chart',label:'Chart',svg:svg('<path d="M3 3v14h14M6.5 13v-3M10 13V6.5M13.5 13V8.5"/>')},
    {id:'chat',label:'Chat',svg:svg('<path d="M4 4h12a1.5 1.5 0 011.5 1.5v7A1.5 1.5 0 0116 14H9.5L6 17v-3H4a1.5 1.5 0 01-1.5-1.5v-7A1.5 1.5 0 014 4z"/>')},
    {id:'mail',label:'Mail',svg:svg('<rect x="2.5" y="4.5" width="15" height="11" rx="1.5"/><path d="M3 5.5l7 5.5 7-5.5"/>')},
    {id:'calendar',label:'Calendar',svg:svg('<rect x="3" y="4.5" width="14" height="12.5" rx="2"/><path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4"/>')},
    {id:'shield',label:'Shield',svg:svg('<path d="M10 2.5l6 2.2v4.8c0 4-2.6 6.6-6 8-3.4-1.4-6-4-6-8V4.7z"/>')},
    {id:'box',label:'Box',svg:svg('<path d="M10 2.5l7 3.5v8l-7 3.5-7-3.5V6zM3 6l7 3.5L17 6M10 9.5v8"/>')},
    {id:'bolt',label:'Bolt',svg:svg('<path d="M11 2.5L4.5 11H10l-1 6.5L15.5 9H10z"/>')},
    {id:'pin',label:'Pin',svg:svg('<path d="M10 17.5s5.5-5 5.5-9.2a5.5 5.5 0 10-11 0c0 4.2 5.5 9.2 5.5 9.2z"/><circle cx="10" cy="8.3" r="2"/>')},
  ];
  const IDS=LIST.map(x=>x.id);
  const MAP={}; LIST.forEach(x=>{MAP[x.id]=x.svg;});
  /* The drawing for an icon id; an unknown id gets the pin (the same fallback the settings parser uses). */
  const iconSvg=id=>Object.prototype.hasOwnProperty.call(MAP,id)?MAP[id]:MAP.pin;
  return {LIST,IDS,iconSvg};
})());
