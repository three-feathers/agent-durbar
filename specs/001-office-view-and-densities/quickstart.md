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
