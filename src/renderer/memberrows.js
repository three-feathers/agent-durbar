/* The permissions row and the limit row of one agent, shared by New session (app.js `newSession`) and the team member editor (spec 111 T009, FR-022,
   spec 021 FR-031: one builder, not two copies). Two parts:
   - pure: capSpec (the unit, the hint and the least amount of the limit field), capParse (the typed amount in the app's unit), PERM_OPTIONS;
   - DOM builders: permRow, capRow. They set text with textContent only. The caller fills the permission list for the app's capabilities
     (app.js `fillPermSelect`) and wires the events.
   In the page: window.DurbarMemberRows; in Node: module.exports (scripts/test-teams-editor.ts). */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarMemberRows=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const PERM_OPTIONS=[['read-only','Read-only'],['ask','Ask first'],['allow','Allow all (no prompts)']];
  const MAX_AIU=1e6, MAX_USD=1e4;

  /* How the limit field reads for a unit. `usd` is Claude's estimate in dollars; otherwise AI credits (an AIU default may fill the field, never a dollar one: spec 011 FR-150).
     `template` (the member editor): an empty AI credits field means "your default limit when the team starts" (FR-002), a dollar one means no limit. */
  function capSpec(usd, o){
    o=o||{};
    const minUsd=o.minUsd>0?o.minUsd:0.01;
    return {
      min: usd?String(minUsd):'0.001',
      hint: usd?'Claude\'s estimate, in dollars. Empty means no limit.':(o.template?'In AI credits. Empty means your default limit.':'In AI credits. Empty means no limit.'),
      placeholder: o.template&&!usd?'Default':'No limit',
    };
  }
  /* The typed text of the limit field in the app's unit: {empty:true}, {amount} (two decimals) or {error:'range'} (not a number, or outside the allowed range). */
  function capParse(usd, text, limits){
    const lim=limits||{};
    const t=String(text==null?'':text).trim();
    if(t==='')return {empty:true};
    const v=parseFloat(t);
    const lo=usd?(lim.minUsd>0?lim.minUsd:0.01):(lim.minAiu>0?lim.minAiu:30), hi=usd?MAX_USD:MAX_AIU;
    if(!(v>=lo&&v<=hi))return {error:'range'};
    return {amount:Math.round(v*100)/100};
  }

  /* <label>Permissions<select id=...>read-only, ask, allow</select></label>; the caller narrows the options to what the app enforces */
  function permRow(doc, o){
    const label=doc.createElement('label');
    if(o&&o.className)label.className=o.className;
    label.appendChild(doc.createTextNode((o&&o.title)||'Permissions'));
    const select=doc.createElement('select');
    if(o&&o.id)select.id=o.id;
    PERM_OPTIONS.forEach(p=>{const op=doc.createElement('option');op.value=p[0];op.textContent=p[1];select.appendChild(op);});
    label.appendChild(select);
    return {label,select,nodes:[label]};
  }
  /* <label id=row><span id=title>Spending limit</span><input type=number id=input></label><small id=hint>…</small>; `o.ids` = {row,title,input,hint}, `o.describedBy` more ids for the input */
  function capRow(doc, o){
    const ids=(o&&o.ids)||{};
    const label=doc.createElement('label'); if(ids.row)label.id=ids.row; if(o&&o.className)label.className=o.className;
    const title=doc.createElement('span'); if(ids.title)title.id=ids.title; title.textContent=(o&&o.title)||'Spending limit';
    const input=doc.createElement('input'); input.type='number'; input.step='0.01'; if(ids.input)input.id=ids.input;
    const hint=doc.createElement('small'); hint.className='dhint'; if(ids.hint)hint.id=ids.hint;
    const spec=capSpec(false,o);
    input.min=spec.min; input.placeholder=spec.placeholder; hint.textContent=spec.hint;
    if(ids.hint)input.setAttribute('aria-describedby',[ids.hint].concat((o&&o.describedBy)||[]).join(' '));
    label.appendChild(title); label.appendChild(input);
    return {label,title,input,hint,nodes:[label,hint]};
  }
  return {PERM_OPTIONS,MAX_AIU,MAX_USD,capSpec,capParse,permRow,capRow};
})());
