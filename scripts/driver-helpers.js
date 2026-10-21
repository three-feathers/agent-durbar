/*
 * Spec 008 FR-096: simulator drivers wait for what they need instead of sleeping a fixed time. A fixed delay is too long on a fast
 * machine and too short on a slow CI runner (macOS); these waits end as soon as the page is ready and give a slow runner time.
 *
 *   const { waits } = require('./driver-helpers');
 *   const { until, settle, office, chatOf } = waits(ctx);
 *
 * `until` never throws: on a timeout it returns false and the driver's own assertion that follows reports what is wrong, so a wait
 * can never hide or weaken a check. Expressions run in the page.
 */
const { jsLiteral } = require('./check-office-overlap.js'); /* CodeQL js/bad-code-sanitization: values spliced into page code */

const LIMIT = 8000;

function waits(ctx) {
  /** Wait until the page expression is truthy (polled every 50 ms), at most `ms`. */
  const until = async (expr, ms = LIMIT) => {
    const end = Date.now() + ms;
    for (;;) {
      if (await ctx.js(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true;
      if (Date.now() > end) {
        console.log(`[waits] timed out after ${ms} ms: ${String(expr).replace(/\s+/g, ' ').slice(0, 160)}`);
        return false;
      }
      await ctx.sleep(50);
    }
  };
  /** Wait until the page stops changing: the same element count and text size twice in a row, 200 ms apart (at most `ms`). */
  const settle = async (ms = LIMIT) => {
    const end = Date.now() + ms;
    let prev = '';
    for (;;) {
      const now = await ctx.js(`document.querySelectorAll('*').length+':'+document.body.innerText.length`);
      if (now === prev || Date.now() > end) return;
      prev = now;
      await ctx.sleep(200);
    }
  };
  /** The office is shown (no chat panel) with at least `n` desks, and it has stopped changing. */
  const office = async (n = 1) => {
    await until(`!document.body.classList.contains('panel-open')&&document.querySelectorAll('#stage .desk[data-id]').length>=${Number(n)}`);
    await settle();
  };
  /** The chat of the agent named `name` is open, and it has stopped changing. */
  const chatOf = async (name) => {
    await until(`document.body.classList.contains('panel-open')&&(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(String(name))}`);
    await settle();
  };
  return { until, settle, office, chatOf };
}

module.exports = { waits, LIMIT };
