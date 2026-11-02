/* Spec 097 FR-040..FR-052: the Real office lights, the pure part. A desk's lamp, screen glow and call light come from its status
   (FR-041), the room ambient from the share of active agents (FR-043), a lobby fixture's light from who is there (FR-045). No DOM, no
   imports: the page loads the compiled file after exports-shim.js (like redact.js) and reads `exports.lightFor` at call time; the
   tests import it. The renderer turns the result into CSS classes over the art (D4); every light repeats a cue that is also in words
   or an icon (FR-046). */

/* The page loads this compiled file as a plain script, so its top-level names are page globals: the private ones carry a prefix
   (lightOwn), and the exported ones are unique (test:realoffice-layout checks both modules load together, spec 097). */

/** The states Real office draws (spec 097 Edge cases "Every status"). */
export type LightState = 'working' | 'thinking' | 'waiting' | 'error' | 'limit' | 'done' | 'idle' | 'asleep';
export type Lamp = 'warm' | 'bright' | 'on' | 'low' | 'off';
export type Glow = 'on' | 'breathe' | 'red' | 'low' | 'off';
export type Call = 'amber' | 'red' | 'orange' | 'green-once' | null;
export type Motion = 'pulse' | 'breathe' | 'fade' | null;
export interface Light { lamp: Lamp; glow: Glow; call: Call; motion: Motion }

/** FR-041, one row per state (the table of the spec, in its order). */
export const LIGHT_TABLE: Readonly<Record<LightState, Light>> = {
  working: { lamp: 'warm', glow: 'on', call: null, motion: null },
  thinking: { lamp: 'on', glow: 'breathe', call: null, motion: 'breathe' },
  waiting: { lamp: 'bright', glow: 'on', call: 'amber', motion: 'pulse' },
  error: { lamp: 'on', glow: 'red', call: 'red', motion: null },
  limit: { lamp: 'on', glow: 'on', call: 'orange', motion: null },
  done: { lamp: 'low', glow: 'low', call: 'green-once', motion: 'fade' },
  idle: { lamp: 'low', glow: 'low', call: null, motion: null },
  asleep: { lamp: 'off', glow: 'off', call: null, motion: null },
};

const lightOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The renderer's status words to a light state. Limit wins over waiting (the agent asks for money, spec 017 FR-019), an error over
 *  the rest; compacting and retrying are thinking (spec 017 FR-026), failing is an error, paused is idle; an unknown word is idle. */
export function lightState(status: string, flags?: { limit?: boolean; paused?: boolean; asleep?: boolean }): LightState {
  const f = flags || {};
  if (f.asleep) return 'asleep';
  if (f.limit) return 'limit';
  if (f.paused) return 'idle';
  const s = String(status || '');
  if (s === 'compacting' || s === 'retrying') return 'thinking';
  if (s === 'failing') return 'error';
  return lightOwn(LIGHT_TABLE, s) ? (s as LightState) : 'idle';
}

/** FR-041 and FR-047: the light of one desk. With `still` (reduced motion or Serious mode) nothing pulses, breathes or fades: the
 *  pulsing call light stays at its bright level, the done tick shows without a fade. */
export function lightFor(state: string, opts?: { still?: boolean }): Light {
  const row = LIGHT_TABLE[lightState(state)];
  return opts && opts.still ? { ...row, motion: null } : { ...row };
}

/** FR-043: an active agent works, thinks, waits for the user, hit its limit or failed. */
export const isActive = (s: LightState): boolean => s === 'working' || s === 'thinking' || s === 'waiting' || s === 'limit' || s === 'error';

/** FR-043: the room ambient, 0.70 (no visible agent active) to 1.00 (all active); an empty office is at full light. */
export function ambientFor(states: readonly LightState[]): number {
  if (!states.length) return 1;
  const share = states.filter(isActive).length / states.length;
  return Math.round((0.7 + 0.3 * Math.min(1, Math.max(0, share))) * 1000) / 1000;
}

/** FR-052: the green tick shows once per transition to done. `seen` maps a desk to the state it had at the last render; the result
 *  is true only when the desk was drawn before in another state and is done now (a reload, a resize or a re-render never ticks). */
export function doneTick(seen: Map<string, LightState>, id: string, state: LightState): boolean {
  const prev = seen.get(id);
  seen.set(id, state);
  return state === 'done' && prev !== undefined && prev !== 'done';
}

export type FixtureLight = 'lamp' | 'busy' | 'glow' | 'soft' | null;
/** FR-045: a lobby fixture's own light. Library and Bank: a lamp while someone is there; Boss: the busy light over the door once a
 *  queue forms (2 or more visitors, or 1 that needs the user); Coffee: the machine glows while someone is there; the other places
 *  (custom ones too): a soft light while occupied. The Postbox has no visitors and no light. */
export function fixtureLight(place: string, visitors: number, needsYou: boolean): FixtureLight {
  if (place === 'postbox' || visitors <= 0) return null;
  if (place === 'library' || place === 'bank') return 'lamp';
  if (place === 'boss') return visitors >= 2 || needsYou ? 'busy' : null;
  if (place === 'coffee') return 'glow';
  return 'soft';
}
