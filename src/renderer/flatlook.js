/* spec 070 FR-061..FR-066 (A14, T034): the switch for Flat's modern look. Off by default: nothing is set, so styles.css's `html[data-flat-look]` block never
   applies and the page is as it was. The owner turns it on with localStorage 'durbar.flatLook' = '1' or ?flatlook=1 until FLAT_LOOK_DEFAULT is made true.
   The block itself holds only Flat (Clean Office, no world): another pack or a world never matches it (FR-066). */
(function(){
  var FLAT_LOOK_DEFAULT=false, on=FLAT_LOOK_DEFAULT;
  try{if(localStorage.getItem('durbar.flatLook')==='1')on=true;}catch(e){/* storage can be blocked: the default */}
  try{if(/[?&]flatlook=1(&|$)/.test(location.search))on=true;}catch(e){/* no location */}
  if(on)document.documentElement.setAttribute('data-flat-look','');
  window.DurbarFlatLook={on:function(){return document.documentElement.hasAttribute('data-flat-look');},set:function(v){if(v)document.documentElement.setAttribute('data-flat-look','');else document.documentElement.removeAttribute('data-flat-look');}};
})();
