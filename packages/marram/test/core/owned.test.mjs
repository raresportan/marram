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

test("a lock whose holder is gone is taken at once, and one whose holder still works is waited for, however long", async () => {
	const root = mkdtempSync(join(tmpdir(), "marram-owned-"));
	try {
		const lock = join(root, "state.lock");
		mkdirSync(lock);
		writeFileSync(join(lock, "running"), String(deadPid()));
		const started = Date.now();
		assert.equal(withLock(lock, () => "mine", { staleMs: 60_000 }), "mine");
		assert.ok(Date.now() - started < 5_000, "taken without waiting for staleMs");
		assert.equal(existsSync(lock), false);
		// Another process holds it for a second, well past staleMs: it's still working, so the lock is waited for.
		const order = join(root, "order");
		const holder = spawn(process.execPath, ["--input-type=module", "-e", `
			import { appendFileSync } from "node:fs";
			import { withLock } from ${JSON.stringify(OWNED)};
			withLock(${JSON.stringify(lock)}, () => {
				appendFileSync(${JSON.stringify(order)}, "held ");
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
				appendFileSync(${JSON.stringify(order)}, "let-go ");
			});
		`], { stdio: "inherit" });
		const exited = new Promise((resolve) => holder.on("exit", resolve));
		for (const until = Date.now() + 20_000; !existsSync(order); ) {
			if (Date.now() > until) assert.fail("the other process never took the lock");
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		withLock(lock, () => writeFileSync(order, `${readFileSync(order, "utf8")}mine`), { staleMs: 50 });
		assert.equal(await exited, 0);
		assert.equal(readFileSync(order, "utf8"), "held let-go mine");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
