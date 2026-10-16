/* Tool usage counts, models and context window per agent (spec 019). Pure: no DOM, no Electron.
   In the page: window.DurbarStats; in Node (tests): module.exports. Kept in memory for the run. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarStats=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const MAX_TOOLS_PER_AGENT=400; /* a runaway tool name list must not grow without bound */

  /* A normalized toolCall event -> where it is counted. MCP tools are grouped by the server that hosts them. */
  function toolKey(ev){
    const server=ev&&ev.mcpServer;
    if(server){const name=ev.mcpTool||ev.tool||'?';return {key:'mcp:'+server+'/'+name,source:'mcp',server:String(server),name:String(name)};}
    const name=(ev&&ev.tool)||'?';
    return {key:'builtin:'+name,source:'builtin',server:'',name:String(name)};
  }

  /* Context window level for the bar colour; limit 0/undefined/unknown -> 'unknown'. */
  function ctxLevel(used,limit){
    if(!(limit>0)||!(used>=0)||used===undefined||used===null)return {pct:null,level:'unknown'};
    const pct=Math.max(0,Math.min(100,Math.round(used/limit*100)));
    return {pct,level:pct>90?'high':pct>=70?'warn':'ok'};
  }
  function fmtTokens(n){
    if(!(n>=0))return '?';
    if(n>=1e6)return (n/1e6).toFixed(n>=1e7?0:1).replace(/\.0$/,'')+'M';
    if(n>=1000)return (n/1000).toFixed(n>=1e5?0:1).replace(/\.0$/,'')+'k';
    return String(Math.round(n));
  }

  /* Built-in first, then MCP servers (by total calls); each with its rows and total. Works on rows of this run and of the all-time document. */
  function groupRows(rows){
    const g=new Map();
    for(const r of rows){
      const key=r.source==='mcp'?'mcp:'+r.server:'builtin';
      let x=g.get(key);
      if(!x){x={key,title:r.source==='mcp'?'MCP: '+r.server:'Built-in',source:r.source,server:r.server,rows:[],total:0};g.set(key,x);}
      x.rows.push(r);x.total+=r.count;
    }
    return [...g.values()].sort((x,y)=>(x.source===y.source?y.total-x.total:x.source==='builtin'?-1:1));
  }

  /* All-time document (spec 020, src/shared/toolusage.ts) -> rows/groups/totals in the same shape as the per-run ones.
     scope: an agent label, or null for all agents. Rows' `agents` hold {label,count}. */
  function docView(doc,scope){
    const empty={rows:[],groups:[],totals:{total:0,failed:0,mcp:0,agents:0}};
    if(!doc||!doc.tools)return empty;
    const rows=[];
    const agents=doc.agents||{};
    const row=(k,t,count,failed)=>({key:k,source:t.source,server:t.server||'',name:t.name,count,failed,agents:[]});
    if(scope){
      const a=agents[scope];if(!a)return empty;
      for(const k of Object.keys(a.tools)){const t=doc.tools[k],c=a.tools[k];if(t&&(c.calls||c.failed))rows.push(row(k,t,c.calls,c.failed));}
    }else{
      for(const k of Object.keys(doc.tools)){
        const t=doc.tools[k];if(!(t.calls||t.failed))continue;
        const r=row(k,t,t.calls,t.failed);
        for(const lab of Object.keys(agents)){const c=agents[lab].tools[k];if(c&&c.calls)r.agents.push({label:lab,count:c.calls});}
        r.agents.sort((x,y)=>y.count-x.count);
        rows.push(r);
      }
    }
    rows.sort((x,y)=>y.count-x.count||x.name.localeCompare(y.name));
    let total=0,failed=0,mcp=0;
    for(const r of rows){total+=r.count;failed+=r.failed;if(r.source==='mcp')mcp+=r.count;}
    const n=scope?(agents[scope]?1:0):Object.keys(agents).filter(l=>agents[l].calls||agents[l].failed).length;
    return {rows,groups:groupRows(rows),totals:{total,failed,mcp,agents:n}};
  }

  function createStats(){
    const agents=new Map(); /* id -> {total,failed,tools:Map,models:Map,ctx} */
    const get=id=>{let a=agents.get(id);if(!a){a={total:0,failed:0,tools:new Map(),models:new Map(),ctx:null};agents.set(id,a);}return a;};
    return {
      /* ev: normalized toolCall event. Counted when the tool starts; a failure is counted on top, not instead. */
      recordTool(id,ev){
        if(!ev||ev.type!=='toolCall')return;
        const a=get(id);
        if(ev.phase!=='start'&&ev.phase!=='failed')return;
        const k=toolKey(ev);
        let t=a.tools.get(k.key);
        if(!t){if(a.tools.size>=MAX_TOOLS_PER_AGENT)return;t=Object.assign({count:0,failed:0},k);a.tools.set(k.key,t);}
        if(ev.phase==='start'){t.count++;a.total++;}else{t.failed++;a.failed++;}
      },
      /* A model call by this agent (normalized usage event). */
      recordModel(id,model){
        if(!model)return;
        const a=get(id);a.models.set(model,(a.models.get(model)||0)+1);
      },
      /* Latest context window numbers (normalized context event of the main agent). */
      setContext(id,ctx){
        if(!ctx||!(ctx.tokens>=0))return;
        get(id).ctx={tokens:ctx.tokens,limit:ctx.limit>0?ctx.limit:0,system:ctx.system,conversation:ctx.conversation,toolDefinitions:ctx.toolDefinitions,model:ctx.model};
      },
      forget(id){agents.delete(id);},
      has(id){return agents.has(id);},
      agentIds(){return [...agents.keys()];},
      agent(id){
        const a=agents.get(id);if(!a)return {total:0,failed:0,models:[],ctx:null};
        return {total:a.total,failed:a.failed,models:[...a.models].map(([name,calls])=>({name,calls})).sort((x,y)=>y.calls-x.calls),ctx:a.ctx};
      },
      /* Rows for the Tools table. scope: an agent id, or null for all agents. Sorted by calls (then name). */
      rows(scope){
        const by=new Map();
        for(const [id,a] of agents){
          if(scope&&id!==scope)continue;
          for(const t of a.tools.values()){
            let r=by.get(t.key);
            if(!r){r={key:t.key,source:t.source,server:t.server,name:t.name,count:0,failed:0,agents:[]};by.set(t.key,r);}
            r.count+=t.count;r.failed+=t.failed;
            if(t.count||t.failed)r.agents.push({id,count:t.count});
          }
        }
        const rows=[...by.values()].filter(r=>r.count>0||r.failed>0);
        rows.forEach(r=>r.agents.sort((x,y)=>y.count-x.count));
        return rows.sort((x,y)=>y.count-x.count||x.name.localeCompare(y.name));
      },
      /* Built-in first, then MCP servers (by total calls); each with its rows and total. */
      groups(scope){return groupRows(this.rows(scope));},
      totals(scope){
        let total=0,failed=0,mcp=0;
        for(const [id,a] of agents){
          if(scope&&id!==scope)continue;
          total+=a.total;failed+=a.failed;
          for(const t of a.tools.values())if(t.source==='mcp')mcp+=t.count;
        }
        return {total,failed,mcp};
      },
    };
  }
  return {createStats,toolKey,ctxLevel,fmtTokens,groupRows,docView};
})());
