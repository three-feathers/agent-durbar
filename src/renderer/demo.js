/* Sample office used by the Demo data toggle (no agents are started). */
(function(){
'use strict';
let ROOMS = [
  {id:'mcp-swiss', name:'mcp-swiss', path:'~/work/mcp-swiss', tint:'sage'},
  {id:'swisscontract-ai', name:'swisscontract-ai', path:'~/work/swisscontract-ai', tint:'blue'},
  {id:'command-center', name:'command-center', path:'~/work/command-center', tint:'sand'},
  {id:'blog', name:'blog', path:'~/work/blog', tint:'clay'}
];
const L=(skin,hair,style,shirt,glasses)=>({skin,hair,style,shirt,glasses:!!glasses});
const S={sk:['#f2d3b8','#e4b794','#c99069','#9d6c4a','#f5dcc8'],hr:['#3b3330','#6b4a35','#2a2a2e','#a9774b','#8c8c91','#c9a15b'],
  sh:['#8fb09a','#7f9fbd','#dcae62','#cf9585','#8e99ad','#adbd93','#b9a0c0']};
const AGENTS = [
 {id:'ada',name:'Ada',role:'Refactorer',room:'mcp-swiss',state:'working',task:'Splitting the tool registry into per-domain modules',look:L(S.sk[0],S.hr[1],'bun',S.sh[0]),
  files:['src/registry.ts','src/tools/index.ts'],ask:'Please split the tool registry by domain (companies, cantons, filings) without changing the public API.',
  think:'The registry is one 900-line file. Domains map cleanly to three modules, so I will move the handlers first and keep a thin re-export in registry.ts. That keeps the public API stable and the diff easy to review.',
  tools:[['read','src/registry.ts','912 lines','ok'],['search','"registerTool"','14 hits','ok'],['edit','src/tools/companies.ts','+188 -0','ok'],['run','vitest registry','running','run']]},
 {id:'ada-t',parent:'ada',name:'Ada-2',role:'Test runner',state:'working',task:'Running vitest on the registry module',look:L(S.sk[1],S.hr[2],'short',S.sh[4]),files:['test/registry.test.ts']},
 {id:'mira',name:'Mira',role:'Test writer',room:'mcp-swiss',state:'thinking',task:'Planning edge cases for the canton lookup tool',look:L(S.sk[2],S.hr[0],'long',S.sh[1],true),
  files:['src/tools/cantons.ts','test/cantons.test.ts'],ask:'Write tests for lookup_canton, including abbreviations and bilingual names.',
  think:'Cases to cover: two-letter codes (ZH, GE), full names in German, French and Italian, mixed case, trailing whitespace, and unknown input. Bilingual cantons like Fribourg/Freiburg need both spellings to resolve to FR.',
  tools:[['read','src/tools/cantons.ts','64 lines','ok'],['read','test/cantons.test.ts','12 lines','ok']]},
 {id:'jonas',name:'Jonas',role:'Reviewer',room:'mcp-swiss',state:'waiting',task:'Needs your OK to rename public tool find_company',look:L(S.sk[3],S.hr[0],'short',S.sh[2]),
  files:['src/tools/companies.ts','CHANGELOG.md'],ask:'Review the registry split and flag anything risky for consumers.',
  think:'The split is behaviour-preserving, but find_company is inconsistent with search_filings and lookup_canton. Renaming is a breaking change for any client that pins tool names, so I should ask before touching it.',
  tools:[['read','git diff main','+412 -388','ok'],['search','"find_company" in clients','3 repos','ok']],
  reply:'One decision for you: rename the public tool find_company to search_companies? It matches the other tools, but it is a breaking change for pinned clients. I can keep find_company as a deprecated alias.',quick:['Rename and keep alias','Rename, no alias','Leave it as is']},
 {id:'noor',name:'Noor',role:'Docs writer',room:'mcp-swiss',state:'done',task:'README tool table updated and linked from the docs index',look:L(S.sk[4],S.hr[5],'curly',S.sh[3]),
  files:['README.md','docs/index.md'],ask:'Refresh the README tool table so it matches the current registry.',
  think:'The table is missing two tools and still lists the old parameter names. I will regenerate it from the registry metadata so it cannot drift again.',
  tools:[['read','README.md','210 lines','ok'],['edit','README.md','+14 -9','ok'],['run','markdown-link-check','0 broken','ok']],
  reply:'Done. The tool table now lists all 11 tools with current parameters, and every link in the docs index resolves.'},

 {id:'elif',name:'Elif',role:'Contract parser',room:'swisscontract-ai',state:'working',task:'Extracting clauses from 14 sample contract PDFs',look:L(S.sk[1],S.hr[0],'long',S.sh[5]),
  files:['pipeline/extract.py','samples/'],ask:'Extract termination and liability clauses from the sample set and report coverage.',
  think:'Eleven of the fourteen PDFs have a text layer. The other three need OCR, so I will hand those to the OCR helper and parse the rest directly.',
  tools:[['read','pipeline/extract.py','230 lines','ok'],['run','python extract.py samples/','11 of 14','run']]},
 {id:'elif-o',parent:'elif',name:'Ocr',role:'OCR helper',state:'working',task:'Reading 3 scanned PDFs',look:L(S.sk[3],S.hr[2],'short',S.sh[1]),files:['samples/scan-02.pdf']},
 {id:'elif-c',parent:'elif',name:'Tag',role:'Tagger',state:'thinking',task:'Choosing labels for ambiguous clauses',look:L(S.sk[0],S.hr[3],'bun',S.sh[6]),files:['labels.yaml']},
 {id:'tomas',name:'Tomas',role:'Prompt tuner',room:'swisscontract-ai',state:'error',task:'Eval run failed: provider rate limit reached',look:L(S.sk[2],S.hr[4],'short',S.sh[4],true),
  files:['evals/run.py','evals/config.yaml'],ask:'Run the clause-extraction eval on prompt v7 and compare with v6.',
  think:'The run stopped at case 38 of 120 with a 429 from the provider. I can retry with lower concurrency, but it will take longer, so I should check with you before changing the eval config.',
  tools:[['run','python evals/run.py --prompt v7','429 rate limit','fail'],['read','evals/config.yaml','28 lines','ok']],
  reply:'The eval stopped at case 38 of 120 because the provider returned a rate limit error. Partial results are saved. I can retry with concurrency 2, which should take about 9 minutes.',quick:['Retry with concurrency 2','Show partial results']},
 {id:'priya',name:'Priya',role:'Migration',room:'swisscontract-ai',state:'idle',task:'Finished schema migration. Nothing queued.',look:L(S.sk[3],S.hr[0],'long',S.sh[0]),
  files:['db/migrations/0007_clauses.sql'],ask:'Add a clauses table and backfill from the old documents JSON.',
  think:'Straightforward additive migration. I will add the table and index first, backfill in batches, and leave the old column in place until you confirm.',
  tools:[['edit','db/migrations/0007_clauses.sql','+42 -0','ok'],['run','migrate up (dry run)','ok','ok']],
  reply:'The migration is applied on the dev database and 1,204 rows were backfilled. I left the old column untouched. Nothing else is queued for me.'},

 {id:'sven',name:'Sven',role:'UI builder',room:'command-center',state:'working',task:'Wiring the agent panel to the status store',look:L(S.sk[0],S.hr[2],'short',S.sh[1]),
  files:['src/panel/AgentPanel.tsx','src/store/status.ts'],ask:'Connect the side panel to the live status store and add the Pause button.',
  think:'The panel currently reads a static fixture. I will subscribe it to the status store and derive the Pause label from the agent state, so the button and the office view cannot disagree.',
  tools:[['read','src/store/status.ts','96 lines','ok'],['edit','src/panel/AgentPanel.tsx','+54 -21','ok'],['run','tsc --noEmit','running','run']]},
 {id:'lena',name:'Lena',role:'Accessibility',room:'command-center',state:'waiting',task:'Choose the focus ring colour: sage or blue?',look:L(S.sk[2],S.hr[1],'bun',S.sh[2],true),
  files:['src/styles/focus.css'],ask:'Audit keyboard focus across the office view.',
  think:'Sage on the off-white floor measures 2.4:1, which is under the 3:1 target for focus indicators. A deeper blue passes at 4.9:1. Both match the palette, so this is a design call.',
  tools:[['read','src/styles/focus.css','18 lines','ok'],['run','contrast-check tokens','2 below 3:1','fail']],
  reply:'The sage focus ring is too faint on the floor colour (2.4:1). Do you prefer a deeper blue (4.9:1) or a darker sage (3.2:1)?',quick:['Deeper blue','Darker sage']},
 {id:'omar',name:'Omar',role:'Bug fixer',room:'command-center',state:'thinking',task:'Tracing why status stays stale after Pause',look:L(S.sk[1],S.hr[0],'short',S.sh[5]),
  files:['src/store/status.ts'],ask:'After pressing Pause the card still shows Working for a few seconds. Find out why.',
  think:'The store updates immediately, so the lag is probably in the render path. A memoised selector may be returning the old object because pause is stored outside the agent record.',
  tools:[['search','"paused" in src/','7 hits','ok'],['read','src/store/status.ts','96 lines','ok']]},

 {id:'clara',name:'Clara',role:'Editor',room:'blog',state:'working',task:'Tightening the intro of the MCP post',look:L(S.sk[4],S.hr[3],'long',S.sh[6],true),
  files:['posts/mcp-in-practice.md'],ask:'Shorten the intro to two paragraphs and keep the opening anecdote.',
  think:'The anecdote carries the intro, so the second and third paragraphs can merge. I will cut the repeated definition of MCP and keep the single sentence readers will quote.',
  tools:[['read','posts/mcp-in-practice.md','1,840 words','ok'],['edit','posts/mcp-in-practice.md','+9 -31','ok']]},
 {id:'hugo',name:'Hugo',role:'Researcher',room:'blog',state:'idle',task:'Collected 6 sources on agent-to-agent protocols',look:L(S.sk[3],S.hr[4],'curly',S.sh[0]),
  files:['research/a2a-notes.md'],ask:'Find recent, credible sources on agent-to-agent protocols.',
  think:'I will prefer primary sources: specs and maintainer posts first, then two independent write-ups for contrast.',
  tools:[['search','agent-to-agent protocol','6 sources','ok'],['edit','research/a2a-notes.md','+58 -0','ok']],
  reply:'Six sources are in research/a2a-notes.md with a one-line summary each. I am idle until you have another topic.'},
 // extra agents, shown only when ?n= is greater than 12
 {id:'rosa',name:'Rosa',role:'Social snippets',room:'blog',state:'working',task:'Drafting three post snippets from the MCP article',look:L(S.sk[2],S.hr[2],'bun',S.sh[1]),files:['posts/snippets.md'],ask:'Draft three short social snippets.',think:'Pull one concrete claim per snippet, no hashtags.',tools:[['edit','posts/snippets.md','+12 -0','ok']]},
 {id:'kenji',name:'Kenji',role:'Evaluator',room:'swisscontract-ai',state:'waiting',task:'Which model should run the baseline comparison?',look:L(S.sk[0],S.hr[0],'short',S.sh[2],true),files:['evals/baseline.py'],ask:'Set up a baseline comparison.',think:'Two candidates fit the budget; the choice changes cost by a factor of three.',tools:[['read','evals/baseline.py','75 lines','ok']],reply:'Which model do you want for the baseline: the faster one or the more accurate one?',quick:['Faster','More accurate']},
 {id:'maya',name:'Maya',role:'Release notes',room:'command-center',state:'done',task:'v0.3 release notes drafted',look:L(S.sk[1],S.hr[5],'long',S.sh[3]),files:['CHANGELOG.md'],ask:'Draft the v0.3 notes.',think:'Group by user-visible change; skip refactors.',tools:[['edit','CHANGELOG.md','+22 -0','ok']],reply:'The notes are in CHANGELOG.md, grouped by what you will notice.'}
];
const EXTRA_IDS=['rosa','kenji','maya'];

// Deterministic fake usage so demo cards show the same usage line as live ones.
AGENTS.forEach((a,i)=>{const n=(i*7919)%13;a.usage={calls:3+n,inT:4000+n*1900,outT:900+n*310,nano:(0.012+n*0.004)*1e9};});
window.DURBAR_DEMO={L,S,ROOMS,AGENTS,EXTRA_IDS};
})();
