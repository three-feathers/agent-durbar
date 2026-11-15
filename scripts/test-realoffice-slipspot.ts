/** Spec 097 FR-110, spec 102 T223: a slip's kept spot (`keptSpotInside`) holds only inside the bounds under the lobby, on all four sides. Pure, plain Node, 0 credits.
 *  A floor with a taller lobby (the arcade's empty floor after the 15-agent hall) moves the bounds down: a spot above them is dropped, not kept over the lobby's plates. */
import * as assert from 'assert';
import { keptSpotInside } from '../src/shared/realoffice-layout';

process.exitCode = 1;
const bounds = { x: 4, y: 263, w: 1432, h: 500 }, size = { w: 289, h: 16 };
const kept = (x: number, y: number): boolean => keptSpotInside({ x, y }, size, bounds);
assert.strictEqual(kept(124, 263), true, 'kept spot: inside the bounds (on the top edge) is kept');
assert.strictEqual(kept(4, 300), true, 'kept spot: on the left edge is kept');
assert.strictEqual(kept(bounds.x + bounds.w - size.w, bounds.y + bounds.h - size.h), true, 'kept spot: in the bottom right corner is kept');
assert.strictEqual(kept(124, 197), false, 'kept spot: ABOVE the new floor\'s bounds (a hall\'s lobby bottom, over the taller lobby\'s plates) is dropped');
assert.strictEqual(kept(2, 300), false, 'kept spot: LEFT of the bounds is dropped');
assert.strictEqual(kept(bounds.x + bounds.w - size.w + 1, 300), false, 'kept spot: past the right edge is dropped');
assert.strictEqual(kept(124, bounds.y + bounds.h - size.h + 1), false, 'kept spot: past the bottom edge is dropped');
console.log('slip kept-spot decision: inside kept, above, left, right and below dropped');
process.exitCode = 0;
