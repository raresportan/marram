// State tables: a lifecycle written down whole, and the supervisor's checked pair by pair.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { test } from "node:test";
import { LIFECYCLE } from "../../src/core/bounded.mjs";
import { machine, tableProblems } from "../../src/core/machine.mjs";

test("a table must say, in every state, where every event leads, and to a state it has", () => {
	assert.deepEqual(tableProblems({ a: { go: "b", stop: "a" }, b: { go: "b" } }), ["b doesn't say where stop leads"]);
	assert.deepEqual(tableProblems({ a: { go: "c" } }), ["go in a leads to c, which isn't a state"]);
	assert.throws(() => machine({ a: { go: "b" } }, "a", () => {}), /Not a whole state table: go in a leads to b/);
	assert.throws(() => machine({ a: { go: "a" } }, "z", () => {}), /starts in z, which isn't a state/);
});

test("a machine moves as its table says, tells step each move, and refuses an event it doesn't know", () => {
	const moves = [];
	const door = machine({ shut: { open: "open", shut: "shut" }, open: { open: "open", shut: "shut" } }, "shut", (move) => moves.push(move));
	door.send("open", "by hand");
	door.send("open");
	assert.equal(door.state, "open");
	assert.deepEqual(moves.map(({ event, from, to }) => `${event}: ${from} → ${to}`), ["open: shut → open", "open: open → open"]);
	assert.deepEqual(moves[0].args, ["by hand"]);
	assert.throws(() => door.send("slam"), /No event slam in this table \(in open\)/);
});

const states = Object.keys(LIFECYCLE);
const events = Object.keys(LIFECYCLE.running);
const TERMINAL = ["done", "failed"];

test("the supervisor's table is whole, and once it has reported, no event makes it report again", () => {
	assert.deepEqual(tableProblems(LIFECYCLE), []);
	for (const state of TERMINAL) for (const event of events) assert.equal(LIFECYCLE[state][event], state, `${event} in ${state}`);
});

test("from every state, the supervisor's own timers end it: the timeout covers whatever the command does", () => {
	// Only the deadline, the grace period, the settling time and the drain poll, which the supervisor sends itself:
	// whatever the command and what it started do (ignore SIGTERM, never let go of the output, leave an exited worker
	// unreaped in its group), these reach a report. The poll sends drained once the command has exited, which SIGKILL at
	// grace makes it do.
	const own = ["deadline", "grace", "settle", "drained"];
	for (const start of states) {
		const seen = new Set([start]);
		const queue = [start];
		while (queue.length > 0) {
			const state = queue.shift();
			for (const next of own.map((event) => LIFECYCLE[state][event])) {
				if (seen.has(next)) continue;
				seen.add(next);
				queue.push(next);
			}
		}
		assert.ok([...seen].some((state) => TERMINAL.includes(state)), `from ${start}, the timers alone reach a report: ${[...seen].join(", ")}`);
	}
});

test("each pair a fix was for leads where that fix said", () => {
	const pairs = {
		// A wrapper that exits, leaving a process holding the output: the timeout still covers it.
		"exited deadline": "halting",
		// An interruption stops what's left of the command too.
		"running interrupt": "halting",
		"exited interrupt": "halting",
		// The command gone and its group empty, while something out of reach holds the output: the caller goes.
		"halting drained": "done",
		// The output closed while a worker in the group ignores SIGTERM: SIGKILL at grace still comes.
		"halting close": "halting",
		"halting grace": "killed",
		"killed close": "killed",
		// An exited worker its parent doesn't reap keeps the group there: after SIGKILL has settled, it isn't waited for.
		"killed settle": "settled",
		"settled drained": "done",
		// A second interruption while halting doesn't start over.
		"halting interrupt": "halting",
		// A spawn error is followed by close: one report, the error's.
		"running error": "failed",
		"failed close": "failed",
		// A deadline that comes after the report.
		"done deadline": "done",
		// Exited and its output let go: done, without waiting for the timeout.
		"exited close": "done",
	};
	for (const [pair, to] of Object.entries(pairs)) {
		const [state, event] = pair.split(" ");
		assert.equal(LIFECYCLE[state][event], to, pair);
	}
});
