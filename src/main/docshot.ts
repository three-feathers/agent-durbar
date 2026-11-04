/**
 * Spec 101 (owner's look at #988): a picture has no window controls, so the room the top bar keeps for macOS's traffic lights would show as
 * an empty gap before the logo. Under `npm run shots:docs` (DURBAR_DOC_SHOTS=1) every driver picture is taken with the app's own
 * full-screen state set (it has no room), then put back as it was. This is the one place all pictures go through (the driver `ctx.shot`).
 */
export async function captureWithoutRoom<T>(run: (code: string) => Promise<unknown>, capture: () => Promise<T>, enabled: boolean): Promise<T> {
  if (!enabled) return capture();
  const was = await run(`(()=>{const h=document.documentElement,w='fullscreen' in h.dataset;h.dataset.fullscreen='';return w;})()`);
  try { return await capture(); } finally { if (!was) await run(`(()=>{delete document.documentElement.dataset.fullscreen;})();0`); }
}
