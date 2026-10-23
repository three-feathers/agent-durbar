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
  /* Spec 068 FR-003: the coffee corner. A lobby tile of its own, after the other places; never a mapping choice (not in PLACES or IDS). */
  const COFFEE='coffee';
  /* Spec 001 FR-034/FR-035/FR-038 (2026-10-22): the Boss (questions and permissions queue there), the Bank (Durbar's spending cap) and the
     Postbox (the next scheduled runs; nobody visits it). Fixed lobby tiles like the coffee corner, never mapping choices. */
  const BOSS='boss', BANK='bank', POSTBOX='postbox';
  const SPECIAL=[COFFEE,BOSS,BANK,POSTBOX];
  /* Custom places (spec 024 FR-021) come from the settings: [{id,name,icon}]. Entries that are not objects with string id and name are skipped. */
  const customList=c=>(Array.isArray(c)?c:[]).filter(p=>p&&typeof p==='object'&&typeof p.id==='string'&&p.id&&typeof p.name==='string');
  /* The five built-ins in their order, then the custom places in creation order. */
  const allPlaces=custom=>[...PLACES,...customList(custom)];
  /* Name of a place: built-in names are fixed here; a custom place shows the user's own text. '' for an unknown id. */
  const placeName=(id,custom)=>{const p=PLACES.find(x=>x.id===id)||customList(custom).find(x=>x.id===id);return p?p.name:'';};
  /* Is `v` a place a mapping may point to: a built-in id, 'desk' or the id of an existing custom place (customIds = array of ids). */
  const isChoice=(v,customIds)=>v==='desk'||IDS.includes(v)||(Array.isArray(customIds)&&customIds.includes(v));
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

  /* Names that count as one server for places (spec 024 FR-012): Copilot's built-in GitHub server is listed as `github`
     but its tool events say `github-mcp-server`. Fixed table, exact names (no case folding, no prefix matching). */
  const SERVER_ALIASES=Object.freeze({'github-mcp-server':'github'});
  /* Canonical name of a server; any other name is returned unchanged. Own-property lookup: `__proto__` etc. stay themselves. */
  function canonicalServer(name){
    return has(SERVER_ALIASES,name)?SERVER_ALIASES[name]:name;
  }

  /* Settings > Places rows (spec 024 FR-013): fold raw server names into canonical ones, once each, sorted. `aliases` = alias names
     seen/listed/saved for that row. `value` = a valid entry under an alias first (classify() lets the call's own name win), else under the canonical name, else ''. */
  function placeRows(names,placeMap,customIds){
    const rows=new Map();
    for(const raw of Array.isArray(names)?names:[]){
      const n=str(raw); if(!n)continue;
      const c=canonicalServer(n);
      if(!rows.has(c))rows.set(c,{name:c,aliases:[],value:''});
      if(c!==n&&!rows.get(c).aliases.includes(n))rows.get(c).aliases.push(n);
    }
    const valid=v=>isChoice(v,customIds);
    return [...rows.values()].map(r=>{
      for(const k of [...r.aliases,r.name]){if(has(placeMap,k)&&valid(placeMap[k])){r.value=placeMap[k];break;}}
      return r;
    }).sort((a,b)=>a.name.localeCompare(b.name));
  }
  /* Names for Settings > Places (spec 024 FR-016): the Copilot CLI servers, the names of every saved folder's extras (`extraResult` is what
     mcpExtraNames() returned; anything but {names:[...]} adds nothing and non-string or empty entries are skipped), servers seen in tool events
     this run and the names already mapped. Each exact name once; placeRows then folds aliases and case-sensitive duplicates stay as they are. */
  function mergePlaceNames(cli,extraResult,seen,mapped){
    const list=v=>Array.isArray(v)?v:[];
    const extra=extraResult&&typeof extraResult==='object'&&Array.isArray(extraResult.names)?extraResult.names:[];
    const all=[...list(cli),...extra,...list(seen),...list(mapped)];
    return [...new Set(all.filter(n=>typeof n==='string'&&n))];
  }
  /* Saves for one row: the canonical key gets the choice (null = default), then every alias key is cleared. */
  function placeSaves(name,place,aliases){
    return [[name,place],...(aliases||[]).map(a=>[a,null])];
  }

  /* Default place of a server, ignoring the user's map. */
  function defaultServerPlace(server){
    const n=str(server); if(!n)return 'other';
    for(const [id,re] of SERVER_RULES)if(re.test(n))return id;
    return 'other';
  }

  /* classify(toolCall, placeMap, customIds) -> place id or 'desk' (stay at the desk). A user mapping for the MCP server wins
     (a place id, a custom place id that exists in `customIds`, or 'desk'; an entry for a place that does not exist is skipped and the default rules apply, never 'desk'). Built-in tools: shell -> terminal, web -> web, everything else (files, search, task, ...) -> desk. */
  function classify(e,placeMap,customIds){
    const ev=e||{}, server=str(ev.mcpServer);
    if(server){
      /* the user's entry under the call's own name wins, then under its canonical name (spec 024 FR-012) */
      for(const k of [server,canonicalServer(server)]){
        if(has(placeMap,k)){const v=placeMap[k];if(isChoice(v,customIds))return v;}
      }
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
      onTool(agentId,e,placeMap,customIds){
        if(!agentId||!e)return false;
        if(v.has(agentId)&&v.get(agentId).pinned)return false; /* spec 068: an agent on a coffee break stays in the coffee corner */
        if(e.phase==='start'){
          const place=classify(e,placeMap,customIds);
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
      /* the turn ended (idle), failed (error) or was stopped: go back to the desk now. Anything else (working, needs-permission, ...)
         keeps the visit: an agent waiting for approval of its shell command stays at the Terminal. */
      onStatus(agentId,status){
        if(!v.has(agentId))return false;
        if(status!=='idle'&&status!=='error'&&status!=='stopped')return false;
        if(v.get(agentId).pinned)return false; /* spec 068: the break ends through unpin, not through the turn's end */
        const r=v.get(agentId); v.delete(agentId); return r.atSince!==null;
      },
      /* a place was deleted: forget every visit to it, shown or still pending; true if one was on screen */
      dropPlace(placeId){let changed=false;v.forEach((r,id)=>{if(r.place===placeId){if(r.atSince!==null)changed=true;v.delete(id);}});return changed;},
      /* Spec 068: the agent stands at `placeId` (the coffee corner) until unpin: no debounce, no dwell; tools and statuses do not move it.
         True when what is on screen changed. */
      pin(agentId,placeId,label){
        if(!agentId)return false;
        const cur=v.get(agentId);
        if(cur&&cur.pinned&&cur.place===placeId){const l=String(label||'');if(cur.label===l)return false;cur.label=l;return true;} /* same place, new label (a question became a permission) */
        v.set(agentId,{place:placeId,label:String(label||''),callId:'',startedAt:now(),atSince:now(),ended:false,pinned:true});
        return true;
      },
      unpin(agentId){const r=v.get(agentId);if(!r||!r.pinned)return false;v.delete(agentId);return true;},
      pinned(agentId){const r=v.get(agentId);return !!r&&!!r.pinned;},
      leave(agentId){const r=v.get(agentId); v.delete(agentId); return !!r&&r.atSince!==null;},
      tick(){
        let changed=false;
        v.forEach((r,id)=>{
          if(settle(r))changed=true;
          if(!r.pinned&&r.ended&&r.atSince!==null&&now()-r.atSince>=dwellMs){v.delete(id);changed=true;}
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

  /* Visitor entries on one lobby tile (spec 001 FR-036): who is there, by name. The tile width comes from lobbyFit (FR-039). A named entry (figure, name and
     activity) takes about 92px, an initials entry 46px, 6px apart, inside 20px of padding. Returns how many of each fit (1..6 each; 0 named
     when not even one fits). chipsFor() picks per tile: names when every visitor fits by name, or when two or more named entries fit (the last
     becomes "+N"); else initials. */
  const NAMED_W=92, INIT_W=46, CHIP_GAP=6, TILE_PAD=20;
  /* chipsIn(w) = the capacities of one tile `w` px wide (lobbyFit's widths; tileSlots/tileChips were removed in the review on #511) */
  function chipsIn(tileW){
    const inner=(Number(tileW)||0)-TILE_PAD;
    const fit=w=>Math.max(0,Math.min(6,Math.floor((inner+CHIP_GAP)/(w+CHIP_GAP))));
    return {named:fit(NAMED_W),initials:Math.max(1,fit(INIT_W))};
  }

  /* Spec 001 FR-039: widths in the lobby row. The Boss, coffee corner, Bank and Postbox (`post`: false when it is not shown, the demo) have
     their own widths; the `places` other tiles share the rest. Start from the preferred widths and shrink the special tiles together,
     proportionally, toward their minimums until every other tile is at least TILE_MIN (two initials entries) wide. Returns
     {boss, coffee, bank, post: {width, named, chips} | null, tile, caps} (caps = the other tiles' entry capacity). */
  const SPECIAL_W={boss:[230,190],coffee:[160,96],bank:[130,96],post:[280,180]}, TILE_MIN=118, COFFEE_NAMED=148, POST_NAMED=240;
  function lobbyFit(aw,places,addButton,post){
    const n=Math.max(1,Math.floor(Number(places)||0)), width=Number(aw)>0?Number(aw):800, withPost=post!==false;
    const keys=Object.keys(SPECIAL_W).filter(k=>withPost||k!=='post');
    const gaps=8*(n+keys.length-1)+(addButton?26+8:0), avail=width-gaps;
    const pref=keys.reduce((t,k)=>t+SPECIAL_W[k][0],0), slack=keys.reduce((t,k)=>t+SPECIAL_W[k][0]-SPECIAL_W[k][1],0);
    const need=Math.max(0,TILE_MIN*n-(avail-pref)), f=slack>0?Math.min(1,need/slack):0;
    const w={}; keys.forEach(k=>{w[k]=Math.floor(SPECIAL_W[k][0]-f*(SPECIAL_W[k][0]-SPECIAL_W[k][1]));});
    const tile=Math.max(0,(avail-keys.reduce((t,k)=>t+w[k],0))/n);
    const box=(k,named)=>w[k]===undefined?null:{width:w[k],named,chips:chipsIn(w[k])};
    return {boss:box('boss',true),coffee:box('coffee',w.coffee>=COFFEE_NAMED),bank:box('bank',true),post:box('post',w.post>=POST_NAMED),tile,caps:chipsIn(tile)};
  }
  /* Spec 001 FR-039: the lobby's tile order: the places, the Boss inserted at the middle of the whole row, then the coffee corner, the Bank
     and the Postbox (when shown). `ids` = the places' ids in their order. */
  function lobbyOrder(ids,post){
    const list=(Array.isArray(ids)?ids:[]).slice(), tail=post===false?[COFFEE,BANK]:[COFFEE,BANK,POSTBOX];
    const at=Math.floor((list.length+tail.length+1)/2), i=Math.min(at,list.length);
    return [...list.slice(0,i),BOSS,...list.slice(i),...tail];
  }
  /* Spec 001 FR-038: the Postbox. Active schedules (not done, not paused, none with Pause all) with their next run, soonest first:
     [{s, t}]. `ruleNext(rule, after)` gives a rule's next run (schedtemplates.js nextRuleRun). */
  function postNext(schedules,pausedAll){
    if(pausedAll)return [];
    return (Array.isArray(schedules)?schedules:[]).filter(s=>s&&!s.done&&!s.paused).map(s=>({s,t:Number((s.every!==undefined||s.rule)?s.next:s.at)||0}))
      .filter(x=>x.t>0).sort((a,b)=>a.t-b.t);
  }
  /* The letters still due today (local time): every run of every active schedule from its next run until midnight. Capped at 999. */
  function lettersToday(schedules,pausedAll,now,ruleNext){
    const t0=Number(now)||Date.now(), end=new Date(t0); end.setHours(24,0,0,0); const mid=end.getTime();
    let n=0;
    for(const {s,t} of postNext(schedules,pausedAll)){
      if(t>=mid)continue;
      if(s.every!==undefined){const ms=Number(s.every)*60000;n+=ms>0?1+Math.floor((mid-1-t)/ms):1;}
      else if(s.rule&&typeof ruleNext==='function'){let k=t,g=0;while(k&&k<mid&&g<50){n++;g++;const x=ruleNext(s.rule,k);k=x>k?x:0;}}
      else n++;
      if(n>=999)return 999;
    }
    return n;
  }
  /* last run missed or failed (the flag), the count: active schedules, and done one-time ones (a one-time run missed while the app was
     closed is marked done with outcome missed). A done repeating schedule is not counted. The one predicate is DurbarSchedTop.missedOrFailed
     (schedtop.js, loaded first; the top-bar Schedules button uses the same), so the Postbox and the button cannot drift (spec 001 FR-038, spec 044 FR-029). */
  const schedTop=()=>typeof module==='object'&&module.exports?require('./schedtop.js'):window.DurbarSchedTop;
  const postMissed=schedules=>(Array.isArray(schedules)?schedules:[]).filter(s=>schedTop().missedOrFailed(s)).length;

  /* Spec 001 FR-036/FR-039: how many initials entries a tile `tileW` px wide shows for `count` visitors. Everyone when they all fit; else
     as many as fit beside the "+N" (a bare 22 px circle in this mode), so a 96 px tile shows one figure and "+1" rather than only "+2". */
  function initialSpots(tileW,count){
    const n=Math.max(0,Math.floor(Number(count)||0)), inner=(Number(tileW)||0)-TILE_PAD;
    if(n*(INIT_W+CHIP_GAP)-CHIP_GAP<=inner)return {shown:n,more:0};
    const shown=Math.max(0,Math.min(n-1,Math.floor((inner-22)/(INIT_W+CHIP_GAP))));
    return {shown,more:n-shown};
  }
  /* {mode:'named'|'initials', slots} for a tile with `visitors` people, from chipsIn()'s capacities */
  function chipsFor(cap,visitors){
    const v=Math.max(0,Math.floor(Number(visitors)||0)), c=cap||{named:0,initials:1};
    if(c.named>=1&&(v<=c.named||c.named>=2))return {mode:'named',slots:c.named};
    return {mode:'initials',slots:Math.max(1,c.initials)};
  }
  /* Two letters for a name ("Omar" -> "Om", "Ada Lovelace" -> "AL"); '' for nothing. Callers escape it. */
  function initialsOf(name){
    const w=String(name||'').trim().split(/\s+/).filter(Boolean);
    if(!w.length)return '';
    const c=s=>Array.from(s);
    return w.length>1?(c(w[0])[0]+c(w[w.length-1])[0]).toUpperCase():c(w[0]).slice(0,2).join('');
  }

  return {PLACES,IDS,COFFEE,BOSS,BANK,POSTBOX,SPECIAL,lobbyFit,lobbyOrder,initialSpots,postNext,lettersToday,postMissed,allPlaces,placeName,isChoice,chipsIn,chipsFor,initialsOf,classify,canonicalServer,placeRows,mergePlaceNames,placeSaves,defaultServerPlace,toolLabel,createVisits,layoutSpots};
})());
