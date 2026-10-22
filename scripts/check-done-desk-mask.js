/*
 * Check for spec 041 FR-065 (issue #541): a token in a done reply never reaches the office floor. Simulator only (no AI credits).
 *
 *   npm run check:done-desk-mask
 *
 * `simreply=secrets`: every done agent's final reply starts with a `ghp_`, a `github_pat_` and an `sk-` token (built at run time here
 * and in sim.ts). At 1440x900 and 1280x800, in Expert and Simple, with no desk selected (so none is grown and the reply is not in the
 * chat): there are done desks whose title shows the masked reply ("Done: Done. Token check: [redacted]..."), and none of the three tokens (nor a piece of one, nor one with `_` and `*` removed)
 * is in the text of the page, in any attribute (title, aria-label, ...), or in the stored task of any agent. A miss prints DRIVER FAILED
 * (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const GHP = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const PAT = 'github' + '_pat_' + '11ABCDEFG0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789abcdefghij';
const SK = 's' + 'k-' + 'proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const NEEDLES = [GHP, PAT, SK, GHP.replace(/_/g, ''), PAT.replace(/_/g, ''), 'A1b2C3d4', '11ABCDEFG0', 'proj-AbCdEf', 'projAbCdEf', 'ghp', 'github_pat', 'githubpat'];
module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const level of ['expert', 'simple']) {
      await H.load({ w, h, query: { simreply: 'secrets' }, ready: 'fit', settle: false });
      await js(`localStorage.setItem('durbar.detail',${jsLiteral(level)})`);
      await H.load({ query: { simreply: 'secrets' }, ready: 'fit' });
      const tag = `${w} ${level}`;
      const seen = await js(`(()=>{
        const done=[...document.querySelectorAll('#stage .desk.is-done')];
        const texts=done.map(d=>d.title||'');
        const agents=window.__durbarSimUi?window.__durbarSimUi.agents():[];
        return {n:done.length,withText:texts.filter(t=>/Done: Done\./.test(t)).length,selected:document.body.classList.contains('panel-open'),sample:texts[0]||'',
          tasks:agents.map(a=>String(a.task||'')).join('\\n')};})()`);
      assert.ok(seen.n > 0 && seen.withText > 0 && !seen.selected, `${tag}: done desks with a text and no open panel: ${JSON.stringify({ n: seen.n, withText: seen.withText, sel: seen.selected, sample: seen.sample })}`);
      const page = await js(`(()=>{const out=[document.body.innerText||'',document.body.textContent||''];
        for(const e of document.querySelectorAll('*'))for(const at of e.attributes)out.push(at.value);return out.join('\\n');})()`);
      for (const nd of NEEDLES) {
        assert.ok(!page.includes(nd), `${tag}: "${nd.slice(0, 12)}..." is not on the page (desk sample: ${JSON.stringify(seen.sample)})`);
        assert.ok(!seen.tasks.includes(nd), `${tag}: "${nd.slice(0, 12)}..." is not in any stored task`);
      }
    }
  }
  console.log('[done-desk-mask] all checks passed');
};
