// Waiting in checks. A check with its own `until` has its own bound (10 s to 60 s, or a count of tries) and its own
// failure ("timed out"), so a wait that fails under the gate's load says neither how long it waited nor what it saw. This one waits a generous minute for everything, and says both.
//
// Time bounds the other way, "this ended quickly", are `sooner`: the bound is half the time the broken behaviour takes,
// so it depends on the check's stand-ins rather than on how loaded the machine is. How work grows with its input is
// `scales`: a ratio of two timings taken together, which load slows alike.
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

/** How long a wait lasts before it fails. Generous, as it only decides how long a failing check takes to fail. */
const LIMIT_MS = 60_000;

const describe = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

/**
 * Waits until `check` holds, failing after a minute with `what` it waited for and, given `seen`, what it last saw:
 * pass `seen` whenever the state behind `check` would explain a failure. A minute outlasts many stand-ins (`sleep 30`):
 * waiting for one to be stopped, follow with `sooner` against its lifetime, or its own exit passes for the stop.
 */
export async function until(check: () => boolean | Promise<boolean>, what: string, seen?: () => unknown): Promise<void> {
	const started = Date.now();
	while (!(await check())) {
		if (Date.now() - started > LIMIT_MS) {
			throw new Error(`Timed out after ${LIMIT_MS / 1000} s waiting for ${what}${seen === undefined ? "" : `; saw ${describe(seen())}`}`);
		}
		await sleep(25);
	}
}

/**
 * Asserts that what began at `started` (a `Date.now()`) ended in under half of `brokenMs`: how long it takes when the
 * behaviour under test is broken, such as a stand-in that hangs for 30 s or a server that answers after 10 s. So the
 * bound holds on a loaded machine yet fails when the behaviour is broken.
 */
export function sooner(started: number, brokenMs: number, what: string): void {
	const elapsed = Date.now() - started;
	assert(elapsed < brokenMs / 2, `${what}: took ${elapsed} ms, when broken it takes ${brokenMs} ms`);
}

/**
 * Asserts that the work `setup(size)` returns grows no faster than `size ** exponent`: it times the work at `from` and
 * at `to` (the best of several runs each) and compares. Linear work grows by about `to / from`, quadratic by its
 * square; an exponent between them tells the two apart on any machine, as both timings share its load.
 */
export function scales(what: string, setup: (size: number) => () => void, { from, to, exponent }: { from: number; to: number; exponent: number }): void {
	const best = (size: number) => {
		const work = setup(size);
		let fastest = Infinity;
		for (let run = 0; run < 5; run++) {
			const started = performance.now();
			work();
			fastest = Math.min(fastest, performance.now() - started);
		}
		return Math.max(fastest, 0.01);
	};
	const small = best(from), large = best(to);
	const grown = Math.log(large / small) / Math.log(to / from);
	assert(grown < exponent, `${what}: from ${from} to ${to} it took ${small.toFixed(2)} ms then ${large.toFixed(2)} ms, growing as size^${grown.toFixed(2)}, above size^${exponent}`);
}
