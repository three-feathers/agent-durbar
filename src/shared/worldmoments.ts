/**
 * Which world moments a pack covers (spec 102 FR-030, FR-031, FR-034). The moment-to-block map below is a copy of `docs/experience/world-moments.json`
 * (the app does not read the registry, spec 098 FR-010); `test:worldpack` keeps the two equal. Pure.
 */

export const MOMENT_BLOCKS: Readonly<Record<string, readonly string[]>> = {
  'office-floor': ['desk-screen', 'fixture', 'person'],
  lobby: ['fixture', 'person', 'light-slots'],
  'boss-bank-post-coffee': ['fixture', 'person', 'light-slots'],
  'desk-card': ['person', 'desk-screen', 'light-slots'],
  'desk-lights': ['light-slots', 'desk-screen'],
  'live-screen': ['desk-screen'],
  lounge: ['person', 'desk-screen', 'light-slots'],
  walk: ['person', 'fixture'],
  'empty-office': ['desk-screen'],
  'first-run': ['fixture', 'panel-frame'],
  'lift-panel': ['lift'],
  'floor-change': ['lift'],
  'floor-indicator': ['lift'],
  'all-floors': ['lift', 'desk-screen', 'fixture'],
  'building-preview': ['lift'],
  'floor-jumps': ['lift'],
  inbox: ['slip', 'fixture'],
  'chat-open': ['panel-frame', 'person'],
  'chat-shell': ['panel-frame', 'person', 'desk-screen', 'light-slots'],
  'chat-header': ['person', 'light-slots', 'panel-frame'],
  'limit-card': ['panel-frame', 'person', 'fixture'],
  'permission-card': ['panel-frame', 'slip', 'person'],
  'question-card': ['panel-frame', 'speech-bubble', 'person'],
  elicitation: ['panel-frame', 'person', 'fixture'],
  'answer-bar': ['speech-bubble', 'person'],
  'coffee-bar': ['person', 'fixture', 'panel-frame'],
};

/** The files a world pack must hold for a block to count as filled. `person` is a set's own pack (FR-205) and `light-slots` come from the manifest (defaults apply). */
export const BLOCK_PARTS: Readonly<Record<string, readonly string[]>> = {
  'desk-screen': ['desk.webp', 'desk-half.webp'],
  fixture: ['fx-library.webp', 'fx-software.webp', 'fx-terminal.webp', 'fx-web.webp', 'fx-boss.webp', 'fx-coffee.webp', 'fx-bank.webp', 'fx-post.webp', 'fx-tools.webp', 'fx-kiosk.webp'],
  lift: ['lift-shaft.webp'],
  'speech-bubble': ['speech-bubble.webp'],
  slip: ['slip.webp'],
  'panel-frame': ['panel-frame.webp'],
  person: [],
  'light-slots': [],
};

/** Moments that need more than their block list says (FR-031): extra files, or the manifest's `rideStyle` (named `rideStyle`). `building-preview` stays optional. */
export const MOMENT_EXTRAS: Readonly<Record<string, readonly string[]>> = {
  'first-run': ['welcome.webp'],
  'floor-change': ['lift-cover.webp', 'rideStyle'],
};

export interface MomentStatus { id: string; covered: boolean; missing: string[] }
export interface CoverageInput { /** file names the pack holds (already validated) */ parts: readonly string[]; /** the manifest's rideStyle, if it has a valid one */ rideStyle?: string | null }

/** Per registry moment: covered, or the files and manifest fields it is missing. Order of `MOMENT_BLOCKS`; `missing` sorted and unique. */
export function momentCoverage(pack: CoverageInput): MomentStatus[] {
  const have = new Set(pack.parts);
  const out: MomentStatus[] = [];
  for (const id of Object.keys(MOMENT_BLOCKS)) {
    const missing = new Set<string>();
    for (const b of MOMENT_BLOCKS[id]) for (const f of BLOCK_PARTS[b] || []) if (!have.has(f)) missing.add(f);
    for (const x of MOMENT_EXTRAS[id] || []) { if (x === 'rideStyle' ? !pack.rideStyle : !have.has(x)) missing.add(x); }
    out.push({ id, covered: missing.size === 0, missing: Array.from(missing).sort() });
  }
  return out;
}

/** Ids of the moments that are not covered: a pack with any is `unfinished` (FR-034). */
export const uncoveredMoments = (pack: CoverageInput): string[] => momentCoverage(pack).filter((m) => !m.covered).map((m) => m.id);

/** The moments a missing file affects (for the report's `moments` field). */
export function momentsNeeding(file: string): string[] {
  return Object.keys(MOMENT_BLOCKS).filter((id) => MOMENT_BLOCKS[id].some((b) => (BLOCK_PARTS[b] || []).includes(file)) || (MOMENT_EXTRAS[id] || []).includes(file));
}
