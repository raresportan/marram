// What the gate said about each state of the working tree, so a hook doesn't run it again for code it has judged.
// Kept in the repository's git folder (shared by its worktrees): marram-gate.json.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// A failure is reused this long, then the gate runs again: a flaky check gets another chance without a code change.
const FAILURE_TTL_MS = 15 * 60 * 1000;
const KEEP = 50;
// What the lock guards takes milliseconds, so a lock this old was left by a hook that was killed.
const STALE_LOCK_MS = 10_000;

export const git = (cwd, args, env = {}) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env } }).trim();

/** The working tree as a git tree hash: tracked and untracked files, not ignored ones. Same hash, same code. */
export function treeOf(cwd) {
	const dir = mkdtempSync(join(tmpdir(), "marram-gate-"));
	const index = join(dir, "index");
	try {
		// A copy of the real index, so unchanged files aren't hashed again.
		const real = resolve(cwd, git(cwd, ["rev-parse", "--git-path", "index"]));
		if (existsSync(real)) copyFileSync(real, index);
		git(cwd, ["add", "-A"], { GIT_INDEX_FILE: index });
		return git(cwd, ["write-tree"], { GIT_INDEX_FILE: index });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const statePath = (cwd) => join(resolve(cwd, git(cwd, ["rev-parse", "--git-common-dir"])), "marram-gate.json");

export function readState(cwd) {
	try {
		const state = JSON.parse(readFileSync(statePath(cwd), "utf8"));
		return { trees: state.trees ?? {}, sessions: state.sessions ?? {} };
	} catch {
		return { trees: {}, sessions: {} };
	}
}

/** Run `action` holding `path`'s lock: a directory, since creating one either succeeds or finds it there. */
function withLock(path, action) {
	const lock = `${path}.lock`;
	for (;;) {
		try {
			mkdirSync(lock);
			break;
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			const age = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
			if (age > STALE_LOCK_MS) rmSync(lock, { recursive: true, force: true });
			else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
		}
	}
	try {
		return action();
	} finally {
		rmSync(lock, { recursive: true, force: true });
	}
}

/**
 * Read, change and write the state under its lock, so hooks running at once don't lose each other's changes; returns
 * what `change` returns. Written to a temporary file and renamed over the old one, so a reader never sees half a file.
 * Only the newest entries are kept.
 */
export function updateState(cwd, change) {
	const path = statePath(cwd);
	return withLock(path, () => {
		const state = readState(cwd);
		const result = change(state);
		const newest = (rows) => Object.fromEntries(Object.entries(rows).sort(([, a], [, b]) => b.at - a.at).slice(0, KEEP));
		const temporary = `${path}.${process.pid}.tmp`;
		writeFileSync(temporary, JSON.stringify({ trees: newest(state.trees), sessions: newest(state.sessions) }, null, 2));
		renameSync(temporary, path);
		return result;
	});
}

/** `{ passed, stage?, log?, at }` for a tree the default or full gate passed, or failed less than 15 minutes ago. */
export function verdictOf(cwd, tree) {
	const verdict = readState(cwd).trees[tree];
	if (verdict === undefined || verdict.passed) return verdict;
	return Date.now() - verdict.at < FAILURE_TTL_MS ? verdict : undefined;
}
