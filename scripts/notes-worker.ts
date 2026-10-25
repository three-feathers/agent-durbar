/** Helper of test-notesstore.ts (spec 083 FR-008): a real process that adds notes to one folder's store, slowly enough to collide. Not a test by itself. */
import * as fs from 'fs';
import { NotesStore } from '../src/main/notesstore';
import type { NotesFs } from '../src/main/notesstore';

const [dir, folder, tag, count] = process.argv.slice(2);
const pause = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
// a slow rename widens the window between read and write, where two unlocked writers would lose a note
const slow = { ...fs, renameSync: (a: string, b: string) => { pause(4); fs.renameSync(a, b); } } as unknown as NotesFs;
const store = new NotesStore(dir, { fs: slow });
(async () => {
  for (let i = 0; i < Number(count); i++) {
    const r = await store.add(folder, 'demo', { text: `${tag} note ${i}` });
    if (!r.ok) { console.error(`${tag} ${i}: ${r.error}`); process.exit(2); }
  }
  process.exit(0);
})();
