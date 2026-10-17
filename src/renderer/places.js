/* Places in the office (spec 024): where a tool call "goes", and who is visiting which place. Pure: no DOM, no timers of its own.
   In the page: window.DurbarPlaces; in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarPlaces=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  /* Fixed set and order (FR-001). Keep the ids in sync with src/shared/places.ts (a test compares them). */
  const PLACES=[
    {id:'library',name:'Library'},
    {id:'software',name:'Software library'},
    {id:'terminal',name:'Terminal'},
    {id:'web',name:'Web'},
    {id:'other',name:'Other tools'},
  ];
  const IDS=PLACES.map(p=>p.id);
  const placeName=id=>{const p=PLACES.find(x=>x.id===id);return p?p.name:'';};
  const str=x=>typeof x==='string'?x.trim():'';
  const has=(o,k)=>!!o&&typeof o==='object'&&Object.prototype.hasOwnProperty.call(o,k);

  /* MCP server names (FR-002). First match wins; anything else is "other". */
  const SERVER_RULES=[
    ['software',/github|gitlab|bitbucket/i],
    ['library',/atlassian|confluence|jira|notion|docs|wiki|notes|drive/i],
    ['web',/playwright|browser|puppeteer|fetch/i],
  ];
  const SHELL=/(bash|powershell|pwsh|shell|terminal|exec|command)|^(sh|zsh|cmd|run)$/i;
  const WEB=/(web_fetch|web_search|fetch|http|browse|url)/i;

  /* Default place of a server, ignoring the user's map. */
  function defaultServerPlace(server){
    const n=str(server); if(!n)return 'other';
    for(const [id,re] of SERVER_RULES)if(re.test(n))return id;
    return 'other';
  }

  /* classify(toolCall, placeMap) -> place id or 'desk' (stay at the desk). A user mapping for the MCP server wins
     (a place id, or 'desk'). Built-in tools: shell -> terminal, web -> web, everything else (files, search, task, ...) -> desk. */
  function classify(e,placeMap){
    const ev=e||{}, server=str(ev.mcpServer);
    if(server){
      if(has(placeMap,server)){const v=placeMap[server];if(v==='desk'||IDS.includes(v))return v;}
      return defaultServerPlace(server);
    }
    const t=str(ev.tool);
    if(!t)return 'desk';
    if(SHELL.test(t))return 'terminal';
    if(WEB.test(t))return 'web';
    return 'desk';
  }

  /* Short text for "at <Place>: <tool>" (escaped by the caller). */
  function toolLabel(e){
    const ev=e||{}, server=str(ev.mcpServer), tool=str(ev.mcpTool)||str(ev.tool);
    const t=server?(server+' '+tool).trim():tool;
    return t.length>60?t.slice(0,59)+'…':t;
  }

  /* Who is at which place. Time is injected; the app calls tick() from a timer and re-renders when it returns true.
     Rules (FR-003): a place call must still be running after debounceMs before the agent goes; it stays at least dwellMs;
     the newest call wins; stop/end/error/idle send the agent back at once; only main agents are tracked (callers skip helper events). */
  function createVisits(opts){
    const o=opts||{}, now=o.now||Date.now;
    const debounceMs=o.debounceMs===undefined?600:o.debounceMs, dwellMs=o.dwellMs===undefined?2000:o.dwellMs;
    const v=new Map(); // agentId -> {place,label,callId,startedAt,atSince,ended}
    const settle=r=>{ /* promote a pending visit whose debounce has passed; true if it became visible */
      if(r.atSince===null&&!r.ended&&now()-r.startedAt>=debounceMs){r.atSince=now();return true;}
      return false;
    };
    return {
      /* returns true when what is on screen changed */
      onTool(agentId,e,placeMap){
        if(!agentId||!e)return false;
        if(e.phase==='start'){
          const place=classify(e,placeMap);
          if(place==='desk')return false;
          const cur=v.get(agentId);
          let changed=cur?settle(cur):false; /* the previous visit may have just become visible */
          const visible=!!cur&&cur.atSince!==null;
          const rec={place,label:toolLabel(e),callId:String(e.callId??''),startedAt:now(),atSince:visible?now():null,ended:false};
          v.set(agentId,rec);
          if(visible&&(cur.place!==rec.place||cur.label!==rec.label))changed=true; /* already at a place: go straight to the new one */
          return changed;
        }
        if(e.phase==='complete'||e.phase==='failed'){
          const r=v.get(agentId); if(!r||r.callId!==String(e.callId??''))return false;
          const changed=settle(r); r.ended=true;
          if(r.atSince===null){v.delete(agentId);return changed;} /* never shown: no flicker */
          return changed;
        }
        return false;
      },
      /* agent status changed (idle, error, stopped, ...): go back to the desk now */
      onStatus(agentId,status){
        if(!v.has(agentId))return false;
        if(status==='working'||status==='thinking'||status==='waiting')return false;
        const r=v.get(agentId); v.delete(agentId); return r.atSince!==null;
      },
      leave(agentId){const r=v.get(agentId); v.delete(agentId); return !!r&&r.atSince!==null;},
      tick(){
        let changed=false;
        v.forEach((r,id)=>{
          if(settle(r))changed=true;
          if(r.ended&&r.atSince!==null&&now()-r.atSince>=dwellMs){v.delete(id);changed=true;}
        });
        return changed;
      },
      /* {place,label,since} while the agent is at a place; null while pending or at its desk */
      at(agentId){const r=v.get(agentId);return r&&r.atSince!==null?{place:r.place,label:r.label,since:r.atSince}:null;},
      occupants(placeId){
        /* arrival order = when the call started (agents promoted in the same tick keep the order they began in) */
        const out=[]; v.forEach((r,id)=>{if(r.atSince!==null&&r.place===placeId)out.push({id,from:r.startedAt});});
        return out.sort((a,b)=>a.from-b.from||(a.id<b.id?-1:1)).map(x=>x.id);
      },
      size(){return v.size;},
    };
  }

  /* How many visitors fit on a place tile: when they do not all fit, the last slot becomes "+N". */
  function layoutSpots(n,capacity){
    const count=Math.max(0,Math.floor(Number(n)||0)), cap=Math.max(0,Math.floor(Number(capacity)||0));
    if(count<=cap)return {shown:count,more:0};
    if(cap<1)return {shown:0,more:count};
    return {shown:cap-1,more:count-(cap-1)};
  }

  return {PLACES,IDS,placeName,classify,defaultServerPlace,toolLabel,createVisits,layoutSpots};
})());
