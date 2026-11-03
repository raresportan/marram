// Layout as relationships between boxes, with half a pixel of slack. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { test } from "node:test";
import { above, apart, inside, near } from "../../src/electron/geometry.ts";

const box = (left, top, right, bottom) => ({ left, top, right, bottom });

test("inside, above and apart hold within half a pixel", () => {
	assert.equal(inside(box(10, 10, 20, 20), box(0, 0, 20, 20)), true);
	assert.equal(inside(box(10, 10, 20.4, 20), box(0, 0, 20, 20)), true);
	assert.equal(inside(box(10, 10, 21, 20), box(0, 0, 20, 20)), false);
	assert.equal(above(box(0, 0, 10, 10), box(0, 10.4, 10, 20)), true);
	assert.equal(above(box(0, 0, 10, 10), box(0, 12, 10, 20), 4), false);
	assert.equal(apart(box(0, 0, 10, 10), box(10, 0, 20, 10)), true);
	assert.equal(apart(box(0, 0, 10, 10), box(9, 9, 20, 20)), false);
	assert.equal(near(10, 10.9), true);
	assert.equal(near(10, 11.5), false);
});
