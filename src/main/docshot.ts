/**
 * Spec 101 (owner's look at #988): a picture has no window controls, so the room the top bar keeps for macOS's traffic lights would show as
 * an empty gap before the logo. Under `npm run shots:docs` (DURBAR_DOC_SHOTS=1) every driver picture is taken with the app's own
 * full-screen state set (it has no room), then put back as it was. This is the one place all pictures go through (the driver `ctx.shot`).
 */
/** Page code: resolves once two animation frames have passed (or after 250 ms). */
export const PAINTED = 'new Promise((r)=>{let n=0;const f=()=>{if(++n>=2)r(0);else requestAnimationFrame(f);};requestAnimationFrame(f);setTimeout(()=>r(0),250);})';

export async function captureWithoutRoom<T>(run: (code: string) => Promise<unknown>, capture: () => Promise<T>, enabled: boolean): Promise<T> {
  if (!enabled) return capture();
  const was = await run(`(()=>{const h=document.documentElement,w='fullscreen' in h.dataset;h.dataset.fullscreen='';return w;})()`);
  /* review of #1322 (Mac retakes): capturePage takes the last painted frame, so without this wait some pictures still kept the gap; two
     animation frames let the closed room paint first (at most 250 ms, for a window that paints no frame) */
  await run(PAINTED);
  try { return await capture(); } finally { if (!was) await run(`(()=>{delete document.documentElement.dataset.fullscreen;})();0`); }
}
