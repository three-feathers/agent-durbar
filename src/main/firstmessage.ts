/**
 * The shared first-message chain (spec 116 T009; spec 111 FR-036 and T013 reuse it, spec 114's rules will too). Pure: no Electron, no fs.
 * A part is a framed block of text that goes in front of the person's first typed message of a session. Each part gets its own nonce
 * (`crypto.randomBytes(8)`, 16 hex characters, drawn in main, never derived from the text), is masked with `maskOutgoing` as one
 * piece (so what is previewed is what is sent) and the parts are joined by a blank line, in the order given.
 */
import { randomBytes } from 'crypto';
import { maskOutgoing } from '../shared/redact';

export interface ChainPart {
  id: string;
  open(nonce: string): string;
  body: string;
  close(nonce: string): string;
}
export interface ChainDeps {
  /** one nonce per part; default `randomBytes(8)` in hex. `nonces` (a preview's) are used as they are. */
  nonce?: () => string;
  nonces?: readonly string[];
}
export interface Chain { text: string; nonces: string[] }

export const drawNonce = (): string => randomBytes(8).toString('hex');
const NONCE_RE = /^[0-9a-f]{16,}$/;

/** The block, or undefined for no parts. A bad nonce (not at least 64 bits of hex) throws: nothing is built on a weak code. */
export function firstMessageChain(parts: readonly ChainPart[], deps: ChainDeps = {}): Chain | undefined {
  if (!parts.length) return undefined;
  const nonces: string[] = [];
  const blocks = parts.map((p, i) => {
    const n = deps.nonces?.[i] ?? (deps.nonce ?? drawNonce)();
    if (!NONCE_RE.test(n)) throw new Error('weak nonce');
    nonces.push(n);
    return maskOutgoing([p.open(n), p.body, p.close(n)].join('\n')).text;
  });
  return { text: blocks.join('\n\n'), nonces };
}
