/* Spec 001 FR-031: lets the compiled shared masking module (dist/shared/redact.js, CommonJS with no imports) load as a plain page
   script, so the page masks with the same code as the main process. redact.js writes to this object; liveact.js, loaded right
   after it, names it window.DurbarRedact. The global stays: the compiled code reads its own constants back through `exports.`.
   redact.js writes to it first; spec 106's brainstate.js and brainsurface.js write to the same object afterwards, so a name they export must never be one that
   another shared module exports (test:braindraw compares the object before and after the brain files load). app.js and renderer.js export nothing. */
self.exports={};
/* spec 102 FR-228: the compiled realoffice-arrangements.js requires realoffice-layout.js; every pure module writes to the one object above */
self.require=function(p){return p==='./realoffice-layout'||p==='./brainstate'?self.exports:null;}; /* spec 106: brainsurface.js requires ./brainstate the same way; and nothing else: page code that looks for a CommonJS module must keep finding none */
