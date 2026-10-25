/**
 * Spec 052 FR-178 (issue #689): the longest answer to an agent's question, in characters. One number for the card's boxes (loaded as a plain
 * page script after `exports-shim.js` and read through `window.exports` at call time, like `mcphealth.ts`), main's check and the adapters,
 * so the page never lets you type what main would refuse or cut. NO imports.
 */
export const MAX_ANSWER = 500;
