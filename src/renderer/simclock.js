/* Spec 001 FR-084: with the simulator and `simclock=<ms>` in the page's query (main sets it only from DURBAR_SIM_CLOCK under the
   simulator), the page's clock starts at that time and runs on from there, so screenshots of unchanged screens match. Loaded first.
   Nothing changes on a normal start. `pinClock(root, ms)` is exported for the unit test (scripts/test-simclock.ts). */
(function (root) {
  function pinClock(g, ms) {
    const R = g.Date;
    const off = ms - R.now();
    class D extends R {
      constructor(...a) { if (a.length === 0) super(R.now() + off); else super(...a); }
      static now() { return R.now() + off; }
    }
    // Date() without `new` returns the time as text, as the real one does
    const F = new Proxy(D, { apply: () => new D().toString() });
    g.Date = F;
    return F;
  }
  function fromQuery(search) {
    const q = new URLSearchParams(search || '');
    const v = q.get('simclock');
    return q.get('sim') && v && /^\d{1,15}$/.test(v) ? Number(v) : undefined;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { pinClock, fromQuery };
  else if (root && root.location) { const ms = fromQuery(root.location.search); if (ms !== undefined) pinClock(root, ms); }
})(typeof window !== 'undefined' ? window : globalThis);
