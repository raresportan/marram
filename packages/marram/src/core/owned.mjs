// A folder or file Marram writes may be shared without its knowing: two gates in two terminals, a hook's gate and an
// agent's, overlapping builds, a probe's copy and the next fault's, a hooks folder other repositories use. Each fix for
// that (docs/mistake-classes.md, `shared`) made one place safe. This module is the one way to do it, and
// scripts/rules.mjs holds Marram's code to it:
//   - a run gets a folder of its own (ownFolder), marked with its process while it runs, so nothing else takes it;
//   - a file another process may read is written whole (writeWhole): to a file of its own, then renamed over the old
//     one, so a reader sees the old file or the new one, never half of one;
//   - what's removed is what this process made, or a folder whose maker is gone (removeIfDone, removeAbandoned);
//   - a lock names its holder, so it's taken from a holder that's gone, never from one that's still working (withLock).
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

/** A folder holds this while the process that owns it runs: that process's id. */
const MARKER = "running";
/** A folder ownFolder is making: `.name.staging-<pid>`. */
const STAGING = /^\.(.+)\.staging-(\d+)$/;

/** Wait `ms` milliseconds without giving up the thread: these are synchronous, and the waits are short. */
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Whether the process `pid` is still running. */
export function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}

/** The process id a marker at `path` names: a number, undefined when there's none, or null when it can't be read. */
function holder(path) {
	let text;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		return error.code === "ENOENT" ? undefined : null;
	}
	const pid = Number(text);
	return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

/**
 * Whether `folder` may still be in use: its marker names a process that's running, or it's there but can't be read
 * (EACCES, say), so whether it's in use isn't known. Only a missing or malformed marker, or a process that's gone, says
 * it's done.
 */
export function inUse(folder) {
	const pid = holder(join(folder, MARKER));
	return pid === null || (pid !== undefined && alive(pid));
}

/**
 * A new folder `name` in `parent`, this process's: made under a staging name, marked with the process id, then renamed,
 * so a process pruning `parent` meanwhile never finds it unmarked. `name` holds the process id, so no other process
 * picks it; one already taken fails (a folder with files in it), and what was staged goes. The mark goes at
 * `release()`, or when the process exits however it ends; the folder stays.
 */
export function ownFolder(parent, name) {
	if (!name.includes(String(process.pid))) throw new Error(`ownFolder: "${name}" must hold the process id (${process.pid}), so no other process picks it`);
	mkdirSync(parent, { recursive: true });
	const staging = join(parent, `.${name}.staging-${process.pid}`);
	const path = join(parent, name);
	try {
		mkdirSync(staging);
		writeFileSync(join(staging, MARKER), String(process.pid));
		renameSync(staging, path);
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw error;
	}
	const release = () => rmSync(join(path, MARKER), { force: true });
	process.once("exit", release);
	return { path, release };
}

/** Removes `folder` unless it may be in use (inUse): whether it did. */
export function removeIfDone(folder) {
	if (inUse(folder)) return false;
	rmSync(folder, { recursive: true, force: true });
	return true;
}

/** Removes each folder in `parent` that ownFolder was making, for a name `isOurs` accepts, when the process making it is gone. */
export function removeAbandoned(parent, isOurs) {
	let entries;
	try {
		entries = readdirSync(parent, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const [, name, pid] = STAGING.exec(entry.name) ?? [];
		if (entry.isDirectory() && name !== undefined && isOurs(name) && !alive(Number(pid))) rmSync(join(parent, entry.name), { recursive: true, force: true });
	}
}

/** Rename `from` over `to`, again for a moment if Windows has `to` open (EPERM, EBUSY). */
export function renameOver(from, to) {
	for (let tries = 0; ; tries++) {
		try {
			return renameSync(from, to);
		} catch (error) {
			if (tries >= 20 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
			pause(50);
		}
	}
}

/**
 * Writes `data` to `path` whole: to a file of this write's own beside it, then renamed over it, so a reader sees the
 * file as it was or as it is now, never half written. `options` are writeFileSync's: `mode` holds from the start, so a
 * hook is never there without being executable.
 */
export function writeWhole(path, data, options = {}) {
	const temporary = `${path}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
	try {
		writeFileSync(temporary, data, { ...options, flag: "wx" });
		renameOver(temporary, path);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
}

/**
 * Runs `action` holding the lock `path` (a folder: making one either succeeds or finds it there), and returns what it
 * returns. The lock names this process: one whose holder is gone is taken over at once. One not marked yet is taken
 * after `staleMs`, the time between making a folder and writing a file in it being far less.
 */
export function withLock(path, action, { staleMs = 10_000 } = {}) {
	for (;;) {
		try {
			mkdirSync(path);
			break;
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			const pid = holder(join(path, MARKER));
			const age = Date.now() - (statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
			const gone = pid !== null && (pid === undefined ? age > staleMs : !alive(pid));
			if (gone) rmSync(path, { recursive: true, force: true });
			else pause(10);
		}
	}
	try {
		writeFileSync(join(path, MARKER), String(process.pid));
		return action();
	} finally {
		rmSync(path, { recursive: true, force: true });
	}
}
