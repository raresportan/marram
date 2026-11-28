// Owned places: a run's folder is its own, a file is written whole, and only what's done is removed.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inUse, ownFolder, removeAbandoned, removeIfDone, withLock, writeWhole } from "../../src/core/owned.mjs";

const OWNED = new URL("../../src/core/owned.mjs", import.meta.url).href;

/** A process id no process has: one that just exited. */
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;

function scratch(run) {
	const root = mkdtempSync(join(tmpdir(), "marram-owned-"));
	try {
		return run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("a file written whole is never seen half written by a reader, and leaves no temporary file", async () => {
	const root = mkdtempSync(join(tmpdir(), "marram-owned-"));
	try {
		const path = join(root, "report.json");
		writeWhole(path, JSON.stringify({ n: -1 }));
		// A writer in another process rewrites a 2 MB document 40 times while this one reads it as fast as it can.
		const writer = spawn(process.execPath, ["--input-type=module", "-e", `
			import { writeWhole } from ${JSON.stringify(OWNED)};
			for (let n = 0; n < 40; n++) writeWhole(${JSON.stringify(path)}, JSON.stringify({ n, pad: "x".repeat(2_000_000) }));
		`], { stdio: "inherit" });
		const done = new Promise((resolve) => writer.on("exit", resolve));
		let finished = false;
		done.then(() => { finished = true; });
		let reads = 0;
		while (!finished) {
			JSON.parse(readFileSync(path, "utf8"));
			reads++;
			await new Promise((resolve) => setImmediate(resolve));
		}
		assert.equal(await done, 0);
		assert.ok(reads > 0);
		assert.equal(JSON.parse(readFileSync(path, "utf8")).n, 39);
		assert.deepEqual(readdirSync(root), ["report.json"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a file written whole has its mode from the start", { skip: process.platform === "win32" && "Windows has no file modes" }, () => scratch((root) => {
	writeWhole(join(root, "pre-push"), "#!/bin/sh\n", { mode: 0o755 });
	assert.equal(statSync(join(root, "pre-push")).mode & 0o777, 0o755);
}));

test("a run's folder is marked as its own until it's released, and a name another process could pick is refused", () => scratch((root) => {
	const { path, release } = ownFolder(join(root, "logs"), `run-${process.pid}`);
	assert.equal(path, join(root, "logs", `run-${process.pid}`));
	assert.equal(inUse(path), true);
	assert.equal(removeIfDone(path), false, "a folder in use isn't removed");
	release();
	assert.equal(inUse(path), false);
	assert.throws(() => ownFolder(join(root, "logs"), "run"), /must hold the process id/);
	writeFileSync(join(path, "log"), "");
	assert.throws(() => ownFolder(join(root, "logs"), `run-${process.pid}`), "a name that's taken fails");
	assert.deepEqual(readdirSync(join(root, "logs")), [`run-${process.pid}`], "and leaves nothing staged");
}));

test("a folder whose maker is gone is removed; one whose marker can't be read may be in use, so it stays", () => scratch((root) => {
	const gone = join(root, "gone");
	mkdirSync(gone);
	writeFileSync(join(gone, "running"), String(deadPid()));
	assert.equal(removeIfDone(gone), true);
	assert.equal(existsSync(gone), false);
	if (process.platform === "win32" || process.getuid?.() === 0) return;
	const unreadable = join(root, "unreadable");
	mkdirSync(unreadable);
	writeFileSync(join(unreadable, "running"), String(process.pid));
	chmodSync(join(unreadable, "running"), 0o000);
	assert.equal(removeIfDone(unreadable), false);
	chmodSync(join(unreadable, "running"), 0o644);
}));

test("a folder a gone process was making is removed, and one a live process is making, or another kind of folder, stays", () => scratch((root) => {
	const names = [`.run-1.staging-${deadPid()}`, `.run-2.staging-${process.pid}`, `.other.staging-${deadPid()}`, ".cache"];
	for (const name of names) mkdirSync(join(root, name));
	removeAbandoned(root, (name) => name.startsWith("run-"));
	assert.deepEqual(readdirSync(root).sort(), [names[3], names[2], names[1]].sort());
}));

// The lock's schedules: each test runs contenders in processes of their own, which can pause at a hook (`judged`, once
// the highest generation's holder is judged gone; `staged`, once its own generation is written but not yet published)
// until a flag file appears, or be killed there, and can hold the lock until a flag appears.
const FLAG_WAIT = "(path) => { while (!existsSync(path)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); }";

/** Lock schedules in `root`: start contenders, wait for flags, and kill what's left at the end. */
function schedule(root) {
	const lock = join(root, "state.locks");
	const order = join(root, "order");
	const flag = (name) => join(root, name);
	const children = [];
	return {
		lock,
		flag,
		order: () => (existsSync(order) ? readFileSync(order, "utf8") : ""),
		/** A process that takes the lock as `name`: at `pauseAt` it marks `<name>-<hook>` and waits for `<name>-go`. */
		contender(name, { pauseAt, holdUntil, holdMs } = {}) {
			const hook = (at) => (pauseAt === at ? `() => { appendFileSync(${JSON.stringify(flag(`${name}-${at}`))}, ""); wait(${JSON.stringify(flag(`${name}-go`))}); }` : "undefined");
			const child = spawn(process.execPath, ["--input-type=module", "-e", `
				import { appendFileSync, existsSync } from "node:fs";
				import { withLock } from ${JSON.stringify(OWNED)};
				const wait = ${FLAG_WAIT};
				withLock(${JSON.stringify(lock)}, () => {
					appendFileSync(${JSON.stringify(order)}, ${JSON.stringify(`${name}-in `)});
					${holdUntil ? `wait(${JSON.stringify(flag(holdUntil))});` : ""}
					${holdMs ? `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${holdMs});` : ""}
					appendFileSync(${JSON.stringify(order)}, ${JSON.stringify(`${name}-out `)});
				}, { judged: ${hook("judged")}, staged: ${hook("staged")} });
			`], { stdio: "inherit" });
			children.push(child);
			return child;
		},
		async appears(path) {
			for (const until = Date.now() + 20_000; !existsSync(path); ) {
				if (Date.now() > until) assert.fail(`${path} never appeared`);
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		},
		exited: (child) => new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve(child.exitCode) : child.on("exit", (code) => resolve(code)))),
		/** A holder that's gone: the highest generation, marked by a process that has exited. */
		goneHolder() {
			mkdirSync(join(lock, "1"), { recursive: true });
			writeFileSync(join(lock, "1", "running"), `${deadPid()} 0000000000000000`);
		},
		end: () => children.forEach((child) => child.kill("SIGKILL")),
	};
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a lock whose holder is gone is taken at once, and one whose holder still works is waited for, however long", async () => {
	const root = mkdtempSync(join(tmpdir(), "marram-owned-"));
	const run = schedule(root);
	try {
		run.goneHolder();
		const started = Date.now();
		assert.equal(withLock(run.lock, () => "mine"), "mine");
		assert.ok(Date.now() - started < 5_000, "taken without waiting");
		assert.deepEqual(readdirSync(run.lock), [], "and it leaves nothing behind: the gone holder's generation and its own");
		// Held for a second by another process: withLock here waits, blocking this process, until it lets go.
		const holder = run.contender("holder", { holdMs: 1000 });
		await run.appears(join(root, "order"));
		withLock(run.lock, () => writeFileSync(join(root, "order"), `${run.order()}mine`));
		assert.equal(await run.exited(holder), 0);
		assert.equal(run.order(), "holder-in holder-out mine");
	} finally {
		run.end();
		rmSync(root, { recursive: true, force: true });
	}
});

test("a process paused after judging the holder gone doesn't take the lock another took meanwhile", async () => {
	const root = mkdtempSync(join(tmpdir(), "marram-owned-"));
	const run = schedule(root);
	try {
		run.goneHolder();
		const first = run.contender("first", { pauseAt: "judged" });
		await run.appears(run.flag("first-judged"));
		const second = run.contender("second", { holdUntil: "release" });
		await run.appears(join(root, "order"));
		writeFileSync(run.flag("first-go"), "");
		await sleep(500);
		assert.equal(run.order(), "second-in ", "the first didn't enter while the second held the lock");
		writeFileSync(run.flag("release"), "");
		assert.deepEqual([await run.exited(second), await run.exited(first)], [0, 0]);
		assert.equal(run.order(), "second-in second-out first-in first-out ");
	} finally {
		run.end();
		rmSync(root, { recursive: true, force: true });
	}
});

test("a process paused with its marker written but not yet published doesn't share the lock with one that takes it meanwhile", async () => {
	const root = mkdtempSync(join(tmpdir(), "marram-owned-"));
	const run = schedule(root);
	try {
		const first = run.contender("first", { pauseAt: "staged" });
		await run.appears(run.flag("first-staged"));
		const second = run.contender("second", { holdUntil: "release" });
		await run.appears(join(root, "order"));
		writeFileSync(run.flag("first-go"), "");
		await sleep(500);
		assert.equal(run.order(), "second-in ", "the first didn't enter while the second held the lock");
		writeFileSync(run.flag("release"), "");
		assert.deepEqual([await run.exited(second), await run.exited(first)], [0, 0]);
		assert.equal(run.order(), "second-in second-out first-in first-out ");
	} finally {
		run.end();
		rmSync(root, { recursive: true, force: true });
	}
});

test("a process killed partway through recovering leaves the live holder's lock whole, past any stale interval", async () => {
	const root = mkdtempSync(join(tmpdir(), "marram-owned-"));
	const run = schedule(root);
	try {
		run.goneHolder();
		// The recoverer judges the holder gone and writes its own generation; the holder takes the lock meanwhile; the
		// recoverer is killed there, before it can do anything about it.
		const recoverer = run.contender("recoverer", { pauseAt: "staged" });
		await run.appears(run.flag("recoverer-staged"));
		const holder = run.contender("holder", { holdUntil: "release" });
		await run.appears(join(root, "order"));
		recoverer.kill("SIGKILL");
		await run.exited(recoverer);
		// A third process, past the 10 s a lock used to be taken after, while the holder still works.
		const third = run.contender("third");
		await sleep(11_000);
		assert.equal(run.order(), "holder-in ", "the third didn't enter while the holder held the lock");
		writeFileSync(run.flag("release"), "");
		assert.deepEqual([await run.exited(holder), await run.exited(third)], [0, 0]);
		assert.equal(run.order(), "holder-in holder-out third-in third-out ");
		assert.deepEqual(readdirSync(run.lock), [], "and the killed recoverer's leftovers are gone");
	} finally {
		run.end();
		rmSync(root, { recursive: true, force: true });
	}
});
