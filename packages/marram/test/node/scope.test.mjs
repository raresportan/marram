// A scope ends everything held for an owner: work first, then the rest, and a failure fails the end without sparing
// the others. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { test } from "node:test";
import { Scope } from "../../src/node/scope.ts";

/** A holder that records when it's ended, holding until then; `fail` makes its end throw. */
function holder(name, log, { stage, fail = false } = {}) {
	const held = new Set([1, 2]);
	return {
		name,
		stage,
		async end(owner) {
			log.push(`${name} starts`);
			await new Promise((done) => setImmediate(done));
			held.delete(owner);
			log.push(`${name} ends`);
			if (fail) throw new Error(`${name} broke`);
		},
		holds: (owner) => held.has(owner),
	};
}

test("work ends before the rest, and each stage's holders end at once", async () => {
	const log = [];
	const scope = new Scope("session");
	scope.hold(holder("pages", log));
	scope.hold(holder("jobs", log, { stage: "work" }));
	scope.hold(holder("processes", log));
	await scope.end(1);
	assert.deepEqual(log, ["jobs starts", "jobs ends", "pages starts", "processes starts", "pages ends", "processes ends"]);
	assert.deepEqual(await scope.holding(1), []);
	assert.deepEqual(await scope.holding(2), ["pages", "jobs", "processes"]);
});

test("one failing doesn't spare the others, but fails the end, naming the owner's kind", async () => {
	const log = [];
	const scope = new Scope("client");
	scope.hold(holder("watches", log, { fail: true }));
	scope.hold(holder("uploads", log));
	await assert.rejects(scope.end(1), /^Error: Couldn't end the client's watches: watches broke$/);
	assert.deepEqual(await scope.holding(1), []);
});

test("a holder that leaves isn't ended", async () => {
	const log = [];
	const scope = new Scope("session");
	const leave = scope.hold(holder("browser", log));
	assert.deepEqual(scope.names, ["browser"]);
	leave();
	await scope.end(1);
	assert.deepEqual(log, []);
});
