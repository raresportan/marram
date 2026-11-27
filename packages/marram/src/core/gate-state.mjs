// What the gate said about each state of the working tree, so a hook doesn't run it again for code it has judged.
// Kept in the repository's git folder (shared by its worktrees): marram-gate.json.
import { execFileSync, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { closeSync, existsSync, fstatSync, linkSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { STAGE_FIELDS } from "./config.mjs";
import { withLock, writeWhole } from "./owned.mjs";

// A failure is reused this long, then the gate runs again: a flaky check gets another chance without a code change.
const FAILURE_TTL_MS = 15 * 60 * 1000;
const KEEP = 50;
// What the lock guards takes milliseconds, so a lock this old was left by a hook that was killed.

export const git = (cwd, args, env = {}) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env } }).replace(/\r?\n$/, "");

/** The working tree as a git tree hash: tracked and untracked files, not ignored ones. Same hash, same code. */
export function treeOf(cwd) {
	const dir = mkdtempSync(join(tmpdir(), "marram-gate-"));
	const index = join(dir, "index");
	try {
		// A copy of the real index, so unchanged files aren't hashed again.
		const real = resolve(cwd, git(cwd, ["rev-parse", "--git-path", "index"]));
		if (existsSync(real)) copyIndex(real, index);
		git(cwd, ["add", "-A"], { GIT_INDEX_FILE: index });
		return git(cwd, ["write-tree"], { GIT_INDEX_FILE: index });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Copy the index at `real` to `copy`, never newer than the index it copied. Git trusts a file whose size and mtime match
 * its entry unless the entry is as new as the index file, so a newer copy would hide a same-size edit made in the second
 * that entry was recorded. The contents and the time come from one open file: git replaces its index by renaming a new
 * one over it, and reading the time by path could take the new index's time for the old contents. The time is that
 * file's whole second, since a Date would round 0.9999 s up to the next one. Older only means more files are read again.
 * `afterRead` runs between reading the contents and the time, for a test to replace the index there.
 */
export function copyIndex(real, copy, afterRead = () => {}) {
	const fd = openSync(real, "r");
	try {
		const contents = readFileSync(fd);
		afterRead();
		const second = Number(fstatSync(fd, { bigint: true }).mtimeNs / 1_000_000_000n);
		writeFileSync(copy, contents);
		utimesSync(copy, second, second);
	} finally {
		closeSync(fd);
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

/**
 * Read, change and write the state under its lock, so hooks running at once don't lose each other's changes; returns
 * what `change` returns. Written whole, so a reader never sees half a file. The lock names its holder (owned.mjs), so a
 * gate that died holding it doesn't keep others out.
 * Only the newest entries are kept.
 */
export function updateState(cwd, change) {
	const path = statePath(cwd);
	return withLock(`${path}.lock`, () => {
		const state = readState(cwd);
		const result = change(state);
		const newest = (rows) => Object.fromEntries(Object.entries(rows).sort(([, a], [, b]) => b.at - a.at).slice(0, KEEP));
		writeWhole(path, JSON.stringify({ trees: newest(state.trees), sessions: newest(state.sessions) }, null, 2));
		return result;
	});
}

/**
 * One stage as the gate runs it: the part of each field STAGE_FIELDS keys (config.mjs), in its order. Whether a stage
 * runs together with the marked stages next to it counts: a full gate that runs a test alongside the build it reads
 * passes on a build from before, so it can't answer for a default gate that runs them one after the other.
 */
export const stageText = (stage) => JSON.stringify(Object.entries(STAGE_FIELDS).flatMap(([field, { key }]) => (typeof key === "function" ? key(stage[field]) : [])));

// The secret that stage keys are made with, in its own file beside the state and readable only by its owner: the state
// holds keys, and with the secret beside them a reader could check guesses at a stage's low-entropy values.
const keyPath = (cwd) => join(resolve(cwd, git(cwd, ["rev-parse", "--git-common-dir"])), "marram-gate.key");

const SECRET = /^[0-9a-f]{64}$/;

/** The secret at `path` if it's a whole one, or undefined. */
function readSecret(path) {
	try {
		const text = readFileSync(path, "utf8");
		return SECRET.test(text) ? text : undefined;
	} catch (error) {
		if (error.code === "ENOENT") return undefined;
		throw error;
	}
}

/**
 * Leave `file` readable by its owner only. On Windows a file's mode doesn't do that, so its inherited permissions are
 * removed and its owner given full control (icacls); where that fails, the file keeps what its folder gives.
 */
function ownerOnly(file) {
	if (process.platform !== "win32") return;
	const user = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
	if (user) spawnSync("icacls", [file, "/inheritance:r", "/grant:r", `${user}:F`], { stdio: "ignore" });
}

/**
 * The secret for stage keys, or undefined when there's none yet; `create` makes it then. It's written whole to a file
 * of its own, made owner-only, and only then published under its name with a hard link, which fails if a secret is
 * already there: a gate starting at the same moment reads a whole secret or none, and both end up with the same one.
 * One that isn't whole (written some other way, or cut short) counts as none, and `create` replaces it.
 */
function secretOf(cwd, create) {
	const path = keyPath(cwd);
	const found = readSecret(path);
	if (found !== undefined || !create) return found;
	const staged = `${path}.${process.pid}.tmp`;
	try {
		writeFileSync(staged, randomBytes(32).toString("hex"), { mode: 0o600 });
		ownerOnly(staged);
		try {
			linkSync(staged, path);
		} catch {
			// Another gate published one first (keep theirs), or what's there isn't whole, or the file system has no hard
			// links: then a rename puts this one there.
			if (readSecret(path) === undefined) renameSync(staged, path);
		}
	} finally {
		rmSync(staged, { force: true });
	}
	return readSecret(path);
}

/**
 * A function from a tier's stages to the key a verdict on them keeps, for the project's `gate` configuration. The key is
 * an HMAC over each stage's command, arguments and `env`, and over the inherited variables `gate.env` names (each one's
 * value, or that it's unset): what decides whether a verdict still answers for the stages as the gate would run them
 * now. Other inherited variables don't count, since PATH, the terminal's and a hook's own differ from run to run. The key
 * gives away nothing of what it's over, which may hold secrets. With no secret yet and `create` unset, there are no keys.
 */
export function stageKeys(cwd, gate, { create = false } = {}) {
	const secret = secretOf(cwd, create);
	if (secret === undefined) return () => undefined;
	const inherited = [...(gate?.env ?? [])].sort().map((name) => [name, process.env[name] ?? null]);
	return (stages, purpose) => {
		if (!Array.isArray(stages)) return undefined;
		const over = [stages.map(stageText), inherited];
		return createHmac("sha256", secret).update(JSON.stringify(purpose === undefined ? over : [purpose, ...over])).digest("hex");
	};
}

/**
 * What a full pass's `coversDefault` is keyed for: a key of its own, versioned, so a full pass recorded before coverage
 * compared the groups stages run in (0.3.0, which keyed it as the default stages' own key) doesn't answer for the
 * default gate.
 */
export const COVERS_DEFAULT = "covers-default:2";

/**
 * `{ passed, tier, stage?, log?, stages, coversDefault?, at }` for a tree `tier` (the default gate, or the full one)
 * passed, or failed less than 15 minutes ago, running the stages the project's `gate` configuration (as loaded now)
 * gives it. The configuration may build its stages from the environment, so the same tree can need other stages than
 * a verdict ran: that verdict doesn't count. A full pass counts for the default gate when it ran the default stages the
 * configuration gives now.
 */
export function verdictOf(cwd, tree, tier, gate) {
	const key = stageKeys(cwd, gate);
	const wanted = key(gate?.tiers?.[tier]);
	if (wanted === undefined) return undefined;
	const { trees } = readState(cwd);
	const project = projectTreeKey(cwd, tree);
	const own = current(trees[verdictKey(project, tier, wanted)]);
	if (own === undefined && tier === "default") {
		const full = `${verdictKey(project, "full")}:`;
		const covers = key(gate?.tiers?.[tier], COVERS_DEFAULT);
		const covering = Object.entries(trees).find(([slot, verdict]) => slot.startsWith(full) && verdict.passed && verdict.coversDefault === covers);
		if (covering !== undefined) return covering[1];
	}
	return own;
}

/** A verdict that still counts: a pass, or a failure from the last FAILURE_TTL_MS. */
const current = (verdict) => (verdict === undefined || verdict.passed || Date.now() - verdict.at < FAILURE_TTL_MS ? verdict : undefined);

/** The config directory within the worktree distinguishes projects sharing the same Git tree and state file. */
export const projectTreeKey = (cwd, tree) => JSON.stringify([git(cwd, ["rev-parse", "--show-prefix"]), tree]);

/**
 * Where a verdict is kept: per project and tree, tier, and the key of the stages it ran, so gates running other stages on
 * the same tree (another environment, at the same time) keep a verdict each.
 */
export const verdictKey = (projectTree, tier, stages) => `${tier === "full" ? `${projectTree}:full` : projectTree}${stages === undefined ? "" : `:${stages}`}`;
