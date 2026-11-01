/* Spec 001 FR-031: lets the compiled shared masking module (dist/shared/redact.js, CommonJS with no imports) load as a plain page
   script, so the page masks with the same code as the main process. redact.js writes to this object; liveact.js, loaded right
   after it, names it window.DurbarRedact. The global stays: the compiled code reads its own constants back through `exports.`.
   Only redact.js may write to it (app.js and renderer.js export nothing). */
self.exports={};
/* spec 102 FR-228: the compiled realoffice-arrangements.js requires realoffice-layout.js; every pure module writes to the one object above */
self.require=function(){return self.exports;};
