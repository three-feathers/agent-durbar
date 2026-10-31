/** Idea chips for any "make one with AI" dialog (themes, characters, worlds): `n` different entries of a list, picked with `rand`. Neutral on purpose (no theme or character knowledge). */
export function pickFrom(list: readonly string[], n: number, rand: () => number = Math.random): string[] {
  const pool = list.slice();
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}
