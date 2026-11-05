/** Spec 097 FR-236 (T185): the light bar's rules as sentences, for both arrangements' layout tests (`rows` in test-realoffice-layout.ts,
 *  `aisles` in test-realoffice-aisles.ts). The numbers are the spec's, written here again (not imported), so a changed constant fails. */
import { lightBar, type Layout, type Rect } from '../src/shared/realoffice-layout';

const meet = (a: Rect, b: Rect, t = 0.5): boolean => a.w > 0 && a.h > 0 && a.x + t < b.x + b.w && b.x + t < a.x + a.w && a.y + t < b.y + b.h && b.y + t < a.y + a.h;

/** How often each rule's harder case came up over a sweep: a mutant can only fail where its case occurs. */
export interface BarTally { bars: number; onEdge: number; poolNarrowed: number; poolDropped: number; hidden: number }
export const barTally = (): BarTally => ({ bars: 0, onEdge: 0, poolNarrowed: 0, poolDropped: 0, hidden: 0 });

export function barProblems(L: Layout, tally?: BarTally): string[] {
  const out: string[] = [];
  const desks = L.zones.flatMap((z) => z.desks);
  const faces = [...desks.map((d) => d.face), ...L.fixtures.flatMap((f) => f.visitors.map((v) => v.face))].filter((f): f is Rect => !!f);
  const chrome = [...L.zones.map((z) => z.sign), ...desks.map((d) => d.marquee).filter((m): m is Rect => !!m)];
  for (const d of desks) {
    const b = lightBar(d, L), m = d.screen;
    if (tally) tally.bars++;
    if (Math.abs(b.bar.w - 0.86 * m.w) > 0.01) out.push(`bar of ${d.id} is ${(b.bar.w / m.w * 100).toFixed(1)} % of its monitor, not 86 %`);
    if (Math.abs(b.bar.x + b.bar.w / 2 - (m.x + m.w / 2)) > 0.01) out.push(`bar of ${d.id} is not centred on its monitor`);
    if (b.bar.x < m.x - 0.01 || b.bar.x + b.bar.w > m.x + m.w + 0.01) out.push(`bar of ${d.id} leaves its monitor's span`);
    if (Math.abs(b.bar.h - 8) > 0.01) out.push(`bar of ${d.id} is ${b.bar.h} px thick`);
    const normal = { x: b.bar.x, y: m.y - 7 - 8, w: b.bar.w, h: 8 };
    const under = chrome.some((r) => meet(normal, r, 0));
    if (under !== b.onEdge) out.push(`bar of ${d.id}: ${under ? 'a sign is where it would be, but it is not on the monitor\'s edge' : 'on the edge with no sign above it'}`);
    if (!b.onEdge && Math.abs(b.bar.y + b.bar.h - (m.y - 7)) > 0.01) out.push(`bar of ${d.id}: its bottom is not 7 px above the monitor`);
    if (b.onEdge) {
      if (tally) tally.onEdge++;
      if (b.bar.y + b.bar.h < m.y + 3 - 0.01) out.push(`bar of ${d.id} on the edge: its bottom is not 3 px over the monitor`);
      if (b.clamp) out.push(`bar of ${d.id} on the edge keeps its clamp`);
    } else if (!b.clamp || Math.abs(b.clamp.y + b.clamp.h - m.y) > 0.01 || Math.abs(b.clamp.x + b.clamp.w / 2 - (m.x + m.w / 2)) > 0.01) out.push(`clamp of ${d.id} does not meet the monitor's top in its middle`);
    for (const r of chrome) if (meet(b.bar, r)) out.push(`bar of ${d.id} meets a sign or marquee ${JSON.stringify(r)}`);
    const facing = faces.some((f) => meet(b.bar, f, 0));
    if (facing !== b.hidden) out.push(`bar of ${d.id}: ${facing ? 'meets a face and is not hidden' : 'hidden with no face on it'}`);
    if (b.hidden) {
      if (tally) tally.hidden++;
      if (d.state !== 'asleep') out.push(`bar of ${d.id} (${d.state}) hidden: only a sleeper sits in front of its monitor`);
      continue; /* nothing of it is drawn */
    }
    if (meet(b.bezel, d.glass, 0)) out.push(`tint of ${d.id} reaches the glass (FR-243: the screen text's background)`);
    if (b.bezel.y < m.y - 0.01 || b.bezel.x < m.x - 0.01 || b.bezel.x + b.bezel.w > m.x + m.w + 0.01) out.push(`tint of ${d.id} leaves the monitor`);
    for (const f of faces) if (meet(b.pool, f)) out.push(`pool of ${d.id} meets a face ${JSON.stringify(f)}`);
    const full = 1.25 * b.bar.w;
    if (b.pool.w < full - 0.01) {
      if (tally) tally.poolNarrowed++;
      if (Math.abs(b.pool.w - m.w) > 0.01) out.push(`pool of ${d.id} is narrowed to ${b.pool.w}, not to its monitor's ${m.w}`);
    } else if (Math.abs(b.pool.w - full) > 0.01) out.push(`pool of ${d.id} is ${b.pool.w} wide, not 1.25 bars`);
    if (Math.abs(b.pool.x + b.pool.w / 2 - (b.bar.x + b.bar.w / 2)) > 0.01) out.push(`pool of ${d.id} is not centred under its bar`);
    const top = d.desk.y + 0.08 * d.desk.full;
    if (b.pool.y > top + 0.01) { if (tally) tally.poolDropped++; } else if (Math.abs(b.pool.y - top) > 0.01) out.push(`pool of ${d.id} starts at ${b.pool.y}, not 8 % down the desk`);
    if (b.cut && !(b.cut.x >= -0.01 && b.cut.y >= -0.01 && b.cut.x + b.cut.w <= b.pool.w + 0.01 && b.cut.y + b.cut.h <= b.pool.h + 0.01)) out.push(`pool of ${d.id}: the glass cut leaves the pool`);
    const glassIn = meet(b.pool, d.glass, 0);
    if (glassIn !== !!b.cut) out.push(`pool of ${d.id}: ${glassIn ? 'covers the glass with no cut' : 'has a cut but no glass'}`);
  }
  return out;
}
