// What a branch changed in the checks that judge it, so a reviewer sees what a green gate means after the change.
// Usage: marram guard-diff <base> [--map <feature map>]…
// Compares the merge base with the working tree: each project's gate tiers (every marram.config.mjs in the repository),
// its push requirement, the package scripts its stages run, the files in core.hooksPath, and the citations of each
// feature map named. It reports and leaves the judgment to the reviewer, so it always exits 0. It starts from the
// repository rather than a project's configuration, so a configuration deleted or broken is reported, not fatal.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { checkoutAt } from "./checkout.mjs";
import { removedCitations } from "./map-diff.mjs";

const TIERS = ["fast", "default", "full"];
const CONFIG = "marram.config.mjs";
const USAGE = "Usage: marram guard-diff <base> [--map <feature map>]…";
const BLIND = "Not compared: test files, the scripts a stage's script runs in turn, and checks a script chooses itself (its own list of tests or journeys).";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trimEnd();
/** Paths from a git command given -z: NUL-separated and never quoted, whatever characters they hold. */
const paths = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).split("\0").filter(Boolean);

/** `cwd`: where the command runs, which `--map` paths are relative to. */
export async function guardDiff(cwd, args) {
	const [base, ...rest] = args;
	if (!base || base.startsWith("-") || rest.length % 2 !== 0 || rest.some((value, i) => (i % 2 === 0 ? value !== "--map" : !value))) throw new Error(USAGE);
	const maps = rest.filter((_, i) => i % 2 === 1);
	const repo = git(cwd, "rev-parse", "--show-toplevel");
	const ancestor = git(repo, "merge-base", git(repo, "rev-parse", "--verify", "--end-of-options", base + "^{commit}"), "HEAD");
	const scratch = mkdtempSync(join(tmpdir(), "marram-guard-diff-"));
	const sections = [];
	try {
		const before = join(scratch, "base");
		checkoutAt(repo, ancestor, before);
		const isConfig = (path) => posix.basename(path) === CONFIG;
		const configs = new Set([...paths(before, "ls-files", "-z"), ...paths(repo, "ls-files", "-z", "--cached", "--others", "--exclude-standard")].filter(isConfig));
		for (const path of [...configs].sort()) {
			const project = posix.dirname(path);
			const lines = compareProject(before, repo, project);
			if (lines.length > 0) sections.push([project === "." ? "(root)" : project, lines]);
		}
		const hooksPath = git(repo, "config", "--default", "", "core.hooksPath");
		if (hooksPath !== "" && !posix.isAbsolute(hooksPath)) {
			const words = { A: "added", D: "deleted", M: "changed", T: "changed" };
			const changed = paths(repo, "diff", "-z", "--name-status", "--no-renames", ancestor, "--", hooksPath);
			const lines = [];
			for (let i = 0; i < changed.length; i += 2) lines.push(`${words[changed[i][0]] ?? changed[i]} ${posix.relative(hooksPath, changed[i + 1])}`);
			for (const file of paths(repo, "ls-files", "-z", "--others", "--exclude-standard", "--", hooksPath)) lines.push(`added ${posix.relative(hooksPath, file)}`);
			if (lines.length > 0) sections.push([`Hooks (${hooksPath})`, lines.sort((a, b) => a.split(" ")[1].localeCompare(b.split(" ")[1]))]);
		}
		for (const map of maps) {
			const lines = removedCitations(cwd, ancestor, map).map(({ feature, citation }) => `removed: ${feature} — ${citation}`);
			if (lines.length > 0) sections.push([`Feature map ${map}`, lines]);
		}
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
	const since = `${ancestor.slice(0, 7)}, the merge base with ${base}`;
	if (sections.length === 0) console.log(`No guard changes since ${since}.`);
	else console.log(`Guard changes since ${since}:\n\n${sections.map(([title, lines]) => [title, ...lines.map((line) => "  " + line)].join("\n")).join("\n")}`);
	console.log(`\n${BLIND}`);
}

/** The project in folder `project` (from the repository root) at the merge base, checked out in `before`, and now. */
function compareProject(before, now, project) {
	const was = gateIn(before, project, "at the merge base");
	const is = gateIn(now, project, "in the working tree");
	const failed = [was, is].filter((side) => side.error);
	if (failed.length > 0) return failed.map((side) => side.error);
	const lines = [];
	for (const tier of TIERS) {
		const [old, current] = [occurrences(was.tiers[tier]), occurrences(is.tiers[tier])];
		for (const [key, stage] of old) {
			if (current.has(key)) continue;
			// Only where the same arguments run with the same environment: a stage of the same name may check something else.
			const still = TIERS.filter((other) => other !== tier && is.tiers[other].some((s) => runs(s) === runs(stage)));
			lines.push(`${tier}: removed ${stage.name}: ${shown(stage.run)}${still.length > 0 ? ` (still in ${still.join(", ")})` : ""}`);
		}
		for (const [key, stage] of current) if (!old.has(key)) lines.push(`${tier}: added ${stage.name}: ${shown(stage.run)}`);
		for (const [key, stage] of current) {
			const previous = old.get(key);
			if (previous === undefined) continue;
			if (JSON.stringify(stage.run) !== JSON.stringify(previous.run)) lines.push(`${tier}: ${stage.name} now runs ${shown(stage.run)} (was ${shown(previous.run)})`);
			// Names only: a value may be a token.
			const [x, y] = [previous.env ?? {}, stage.env ?? {}];
			const changed = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((name) => x[name] !== y[name]).sort();
			if (changed.length > 0) lines.push(`${tier}: ${stage.name} env changed: ${changed.join(", ")}`);
		}
		// Stages run in order, so the order of those on both sides is a change of its own.
		const [kept, keptNow] = [[...old.keys()].filter((key) => current.has(key)), [...current.keys()].filter((key) => old.has(key))];
		if (kept.join("\0\0") !== keptNow.join("\0\0")) lines.push(`${tier}: order now ${keptNow.map((key) => current.get(key).name).join(", ")} (was ${kept.map((key) => old.get(key).name).join(", ")})`);
	}
	if (was.prePush !== is.prePush) lines.push(`prePush: ${was.prePush} → ${is.prePush}`);
	const all = (gate) => TIERS.flatMap((tier) => gate.tiers[tier]);
	lines.push(...scriptChanges(before, now, project, all(was), all(is)));
	return lines;
}

/** What a stage runs: its arguments and its environment. */
const runs = ({ run, env = {} }) => JSON.stringify([run, Object.entries(env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))]);

/** A tier's stages by name and occurrence (the second stage named "test" is "test" 2), in order. */
function occurrences(stages) {
	const seen = new Map();
	return new Map(stages.map((stage) => {
		const count = (seen.get(stage.name) ?? 0) + 1;
		seen.set(stage.name, count);
		return [JSON.stringify([stage.name, count]), stage];
	}));
}

// Run in a process of its own, from the project's folder, so a configuration that reads files relative to where it
// runs reads its own side's, and each side's modules are loaded fresh. The answer goes to file descriptor 3, so what a
// configuration prints as it loads can't be mistaken for it.
const READ_GATE = `
import { writeSync } from "node:fs";
const answer = (value) => writeSync(3, JSON.stringify(value));
try {
	const gate = (await import(process.argv[1])).default?.gate ?? {};
	const stages = (tier) => (Array.isArray(gate.tiers?.[tier]) ? gate.tiers[tier] : []).map(({ name, run, env }) => ({ name: String(name), run: Array.isArray(run) ? run.map(String) : [], env }));
	answer({ tiers: { fast: stages("fast"), default: stages("default"), full: stages("full") }, prePush: gate.prePush ?? "default" });
} catch (error) {
	answer({ error: String(error?.message ?? error).split("\\n")[0] });
}`;

/** `{ tiers, prePush }` of `project` under `top` (no stages where it has no configuration), or `{ error }` saying why not. */
function gateIn(top, project, where) {
	const folder = join(top, project);
	if (!existsSync(join(folder, CONFIG))) return { tiers: { fast: [], default: [], full: [] }, prePush: "default" };
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", READ_GATE, pathToFileURL(join(folder, CONFIG)).href], { cwd: folder, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "ignore", "ignore", "pipe"] });
	const answer = result.output?.[3] ? JSON.parse(result.output[3]) : { error: result.error?.message ?? "it exited without giving its gate" };
	return answer.error === undefined ? answer : { error: `couldn't load ${CONFIG} ${where}: ${answer.error}` };
}

/**
 * Changes to the package scripts the stages run, found in each revision on its own: a script of the stage's package
 * (its workspace, named by -w or --workspace, or else the project's own) whose name is one of the stage's arguments,
 * and for npm the pre and post scripts it runs around it. A script is matched across revisions by the stage that runs
 * it, so a stage whose arguments changed still has its script compared. A stage on one side only is the tiers' to
 * report, and so is a stage that starts or stops running a script that's there on both sides.
 */
function scriptChanges(before, now, project, wasStages, isStages) {
	const scriptsAt = (top, folder) => {
		try {
			return JSON.parse(readFileSync(join(top, folder, "package.json"), "utf8")).scripts ?? {};
		} catch {
			return {};
		}
	};
	/** Each stage name and script name, to the package that holds that script and what the script runs, if anything. */
	const resolve = (top, stages) => {
		const found = new Map();
		for (const { name: stage, run } of stages) {
			const folder = workspaceOf(top, project, run) ?? project;
			const scripts = scriptsAt(top, folder);
			// npm runs a script's pre and post scripts around it; other runners don't by default.
			const npm = /^npm(\.cmd)?$/.test(posix.basename(run[0] ?? ""));
			for (const arg of run.slice(1)) {
				if (!Object.hasOwn(scripts, arg)) continue;
				for (const name of npm ? [`pre${arg}`, arg, `post${arg}`] : [arg]) {
					found.set(JSON.stringify([stage, name]), { name, folder, where: posix.join(folder, "package.json"), body: scripts[name] });
				}
			}
		}
		return found;
	};
	const [was, is] = [resolve(before, wasStages), resolve(now, isStages)];
	const named = (stages) => new Set(stages.map(({ name }) => name));
	const [hadStage, hasStage] = [named(wasStages), named(isStages)];
	const removed = ({ name, where, body }) => `script ${name} (${where}): removed (was ${body})`;
	const added = ({ name, where, body }) => `script ${name} (${where}): added: ${body}`;
	const lines = new Set();
	for (const [key, old] of was) {
		const current = is.get(key);
		const stage = JSON.parse(key)[0];
		if (current === undefined) {
			if (old.body !== undefined && hasStage.has(stage) && scriptsAt(now, old.folder)[old.name] === undefined) lines.add(removed(old));
		} else if (current.body === undefined) {
			if (old.body !== undefined) lines.add(removed(old));
		} else if (old.body === undefined) {
			lines.add(added(current));
		} else if (current.where !== old.where || current.body !== old.body) {
			const where = current.where === old.where ? current.where : `${current.where}, was ${old.where}`;
			lines.add(`script ${current.name} (${where}): ${current.body}${current.body === old.body ? "" : ` (was ${old.body})`}`);
		}
	}
	for (const [key, current] of is) {
		const stage = JSON.parse(key)[0];
		if (!was.has(key) && current.body !== undefined && hadStage.has(stage) && scriptsAt(before, current.folder)[current.name] === undefined) lines.add(added(current));
	}
	return [...lines].sort();
}

/** The folder (from the repository root) of the workspace `run` names with -w or --workspace, by path or package name. */
function workspaceOf(top, project, run) {
	const at = run.findIndex((arg) => arg === "-w" || arg === "--workspace" || arg.startsWith("--workspace="));
	if (at === -1) return undefined;
	const name = run[at].startsWith("--workspace=") ? run[at].slice("--workspace=".length) : run[at + 1];
	if (!name) return undefined;
	const byPath = posix.normalize(posix.join(project, name));
	if (existsSync(join(top, byPath, "package.json"))) return byPath;
	for (const file of paths(top, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ":(glob)**/package.json")) {
		try {
			if (JSON.parse(readFileSync(join(top, file), "utf8")).name === name) return posix.dirname(file);
		} catch {
			// A package.json that isn't JSON names no workspace.
		}
	}
	return undefined;
}

/** A command as a shell would take it: each argument whole, quoted when it holds anything but plain characters. */
const shown = (run) => run.map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`)).join(" ");
