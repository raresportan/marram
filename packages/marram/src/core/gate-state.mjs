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

export const git = (cwd, args, env = {}) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env } }).replace(/\r?\n$/, "");

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

/**
 * `{ passed, tier, stage?, log?, stages?, at }` for a tree `tier` (the default gate, or the full one) passed, or failed
 * less than 15 minutes ago. A full pass counts for the default gate when it ran every one of `tiers.default`'s stages,
 * in order, as they're configured now.
 */
export function verdictOf(cwd, tree, tier, tiers) {
	const trees = readState(cwd).trees;
	const project = projectTreeKey(cwd, tree);
	const own = current(trees[verdictKey(project, tier)]);
	// Tiers are the project's to define, so a full gate needn't contain the default one: a pass reused for a gate whose
	// stages it didn't run would let through code that gate fails.
	if (own === undefined && tier === "default") {
		const full = trees[verdictKey(project, "full")];
		if (full?.passed && Array.isArray(full.stages) && ranInOrder(full.stages, stagesOf(tiers?.default ?? []))) return full;
	}
	return own;
}

/** What each stage runs: its command, arguments and environment. A name only labels a log. */
export const stagesOf = (stages) => stages.map(({ run, env = {} }) => JSON.stringify([run, Object.entries(env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))]));

/** Whether `ran` includes each of `wanted`, in the same order; other stages may come between them. */
function ranInOrder(ran, wanted) {
	let found = 0;
	for (const stage of ran) if (stage === wanted[found]) found++;
	return found === wanted.length;
}

/** A verdict that still counts: a pass, or a failure from the last FAILURE_TTL_MS. */
const current = (verdict) => (verdict === undefined || verdict.passed || Date.now() - verdict.at < FAILURE_TTL_MS ? verdict : undefined);

/** The config directory within the worktree distinguishes projects sharing the same Git tree and state file. */
export const projectTreeKey = (cwd, tree) => JSON.stringify([git(cwd, ["rev-parse", "--show-prefix"]), tree]);

export const verdictKey = (projectTree, tier) => (tier === "full" ? `${projectTree}:full` : projectTree);
