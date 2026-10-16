# Quickstart: re-measure the office

Needs Linux with `xvfb-run` (no AI credits, no Copilot login).

```bash
npm ci && npm run build
cat > /tmp/office-driver.js <<'JS'
module.exports = async (ctx) => {
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h); await ctx.sleep(1500);
    console.log(w + 'x' + h, await ctx.js(`(()=>{const st=document.getElementById('stage');
      let min=999;document.querySelectorAll('#stage *').forEach(e=>{if(!e.children.length&&e.textContent.trim())min=Math.min(min,parseFloat(getComputedStyle(e).fontSize));});
      return JSON.stringify({density:st.dataset.d,fit:st.dataset.fit,minFont:min,
        pageOverflow:document.documentElement.scrollHeight>innerHeight+1||document.documentElement.scrollWidth>innerWidth+1,
        floorScrolls:document.getElementById('floor').classList.contains('scrolls'),desks:document.querySelectorAll('.desk').length});})()`));
  }
};
JS
DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_DRIVER=/tmp/office-driver.js xvfb-run -a npx electron . --no-sandbox
```

Expected on 2026-10-16: `roomy` @1440x900 (min font 11), `mini` @1280x800 (min font 10.5), `fit: ok`, no overflow, 15 desks.
A screenshot of the same state: `DURBAR_SHOT=/tmp/out.png DURBAR_SHOT_SIZE=1280x800 DURBAR_SIM=15 npm start`.

## Overlap / clipping check (no AI credits)

```bash
npm run check:office                       # builds, runs Electron (xvfb-run on Linux without DISPLAY), exits 1 on any overlap
OFFICE_QUICK=1 npm run check:office        # smaller matrix
OFFICE_SHOTS=/tmp/shots OFFICE_SHOT_PREFIX=m7b npm run check:office   # also saves screenshots per combination
```

It loads `?sim=12|15&simfreeze=1[&closed=...]` at 1440x900 and 1280x800 and fails on intersecting desk cards / helper tiles / `+N more` chips / helper strips / door plates, boxes outside their room, unit or the floor, a helper strip with a background or a height that is not its content's, floor scroll, page overflow and text under 10.5px.
