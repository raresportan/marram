// What a branch changed in the checks that judge it, so a reviewer sees what a green gate means after the change.
// Usage: marram guard-diff <base> [--map <feature map>]…
// Compares the merge base with the working tree: each project's gate tiers (every marram.config.mjs in the repository),
// its push requirement, the package scripts its stages run, the files in core.hooksPath, and the citations of each
// feature map named. It reports and leaves the judgment to the reviewer, so it always exits 0.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { checkoutAt } from "./checkout.mjs";
import { removedCitations } from "./map-diff.mjs";

const TIERS = ["fast", "default", "full"];
const CONFIG = "marram.config.mjs";
const USAGE = "Usage: marram guard-diff <base> [--map <feature map relative to project>]…";
const BLIND = "Not compared: test files, the scripts a stage's script runs in turn, and checks a script chooses itself (its own list of tests or journeys).";

export async function guardDiff(root, _config, args) {
	const [base, ...rest] = args;
	if (!base || base.startsWith("-") || rest.length % 2 !== 0 || rest.some((value, i) => (i % 2 === 0 ? value !== "--map" : !value))) throw new Error(USAGE);
	const maps = rest.filter((_, i) => i % 2 === 1);
	const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trimEnd();
	const repo = git(root, "rev-parse", "--show-toplevel");
	const ancestor = git(root, "merge-base", git(root, "rev-parse", "--verify", "--end-of-options", base + "^{commit}"), "HEAD");
	const scratch = mkdtempSync(join(tmpdir(), "marram-guard-diff-"));
	const sections = [];
	try {
		const before = join(scratch, "base");
		checkoutAt(repo, ancestor, before);
		const files = (cwd, ...args) => git(cwd, ...args).split("\n").filter(Boolean);
		const configs = new Set([...files(before, "ls-files"), ...files(repo, "ls-files", "--cached", "--others", "--exclude-standard")].filter((path) => posix.basename(path) === CONFIG));
		for (const path of [...configs].sort()) {
			const project = posix.dirname(path);
			const lines = await compareProject(before, repo, project);
			if (lines.length > 0) sections.push([project === "." ? "(root)" : project, lines]);
		}
		const hooksPath = git(repo, "config", "--default", "", "core.hooksPath");
		if (hooksPath !== "" && !posix.isAbsolute(hooksPath)) {
			const words = { A: "added", D: "deleted", M: "changed" };
			const lines = files(repo, "diff", "--name-status", "--no-renames", ancestor, "--", hooksPath)
				.map((line) => line.split("\t"))
				.map(([status, file]) => `${words[status[0]] ?? status} ${posix.relative(hooksPath, file)}`);
			if (lines.length > 0) sections.push([`Hooks (${hooksPath})`, lines]);
		}
		for (const map of maps) {
			const lines = removedCitations(root, ancestor, map).map(({ feature, citation }) => `removed: ${feature} — ${citation}`);
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
async function compareProject(before, now, project) {
	const was = await configIn(before, project, "at the merge base");
	const is = await configIn(now, project, "in the working tree");
	const failed = [was, is].filter((side) => side.error);
	if (failed.length > 0) return failed.map((side) => side.error);
	const lines = [];
	const tiersOf = (config) => Object.fromEntries(TIERS.map((tier) => [tier, Array.isArray(config.gate?.tiers?.[tier]) ? config.gate.tiers[tier] : []]));
	const [a, b] = [tiersOf(was.config), tiersOf(is.config)];
	for (const tier of TIERS) {
		const named = (stages) => new Map(stages.map((stage) => [stage.name, stage]));
		const [old, current] = [named(a[tier]), named(b[tier])];
		for (const [name, stage] of old) {
			if (current.has(name)) continue;
			const still = TIERS.filter((other) => other !== tier && b[other].some((s) => s.name === name));
			lines.push(`${tier}: removed ${name}: ${command(stage)}${still.length > 0 ? ` (still in ${still.join(", ")})` : ""}`);
		}
		for (const [name, stage] of current) if (!old.has(name)) lines.push(`${tier}: added ${name}: ${command(stage)}`);
		for (const [name, stage] of current) {
			const previous = old.get(name);
			if (previous === undefined) continue;
			if (command(stage) !== command(previous)) lines.push(`${tier}: ${name} now runs ${command(stage)} (was ${command(previous)})`);
			// Names only: a value may be a token.
			const [x, y] = [previous.env ?? {}, stage.env ?? {}];
			const changed = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((key) => x[key] !== y[key]).sort();
			if (changed.length > 0) lines.push(`${tier}: ${name} env changed: ${changed.join(", ")}`);
		}
	}
	const [push, pushNow] = [was.config.gate?.prePush ?? "default", is.config.gate?.prePush ?? "default"];
	if (push !== pushNow) lines.push(`prePush: ${push} → ${pushNow}`);
	lines.push(...scriptChanges(before, now, project, [...TIERS.flatMap((tier) => [...a[tier], ...b[tier]])]));
	return lines;
}

/** `{ config }`, the configuration of `project` under `top` (empty where there is none), or `{ error }` saying why not. */
async function configIn(top, project, where) {
	const file = join(top, project, CONFIG);
	if (!existsSync(file)) return { config: {} };
	try {
		// A query of its own, so a config already imported (the CLI loads the project's) is read again as it is now.
		return { config: (await import(`${pathToFileURL(file).href}?guard-diff=${Date.now()}`)).default ?? {} };
	} catch (error) {
		return { error: `couldn't load ${CONFIG} ${where}: ${error.message.split("\n")[0]}` };
	}
}

/**
 * Changes to the package scripts `stages` run: a script of the stage's package (its workspace, named by -w or
 * --workspace, or else the project's own) whose name is one of the stage's arguments.
 */
function scriptChanges(before, now, project, stages) {
	const scriptsAt = (top, folder) => {
		try {
			return JSON.parse(readFileSync(join(top, folder, "package.json"), "utf8")).scripts ?? {};
		} catch {
			return {};
		}
	};
	const used = new Map();
	for (const { run = [] } of stages) {
		const folder = workspaceOf(now, project, run) ?? project;
		const names = used.get(folder) ?? new Set();
		const scripts = { ...scriptsAt(before, folder), ...scriptsAt(now, folder) };
		for (const arg of run.slice(1)) if (Object.hasOwn(scripts, arg)) names.add(arg);
		used.set(folder, names);
	}
	const lines = [];
	for (const [folder, names] of used) {
		const [was, is] = [scriptsAt(before, folder), scriptsAt(now, folder)];
		const where = posix.join(folder, "package.json");
		for (const name of [...names].sort()) {
			if (was[name] === is[name]) continue;
			if (is[name] === undefined) lines.push(`script ${name} (${where}): removed (was ${was[name]})`);
			else if (was[name] === undefined) lines.push(`script ${name} (${where}): added: ${is[name]}`);
			else lines.push(`script ${name} (${where}): ${is[name]} (was ${was[name]})`);
		}
	}
	return lines;
}

/** The folder (from the repository root) of the workspace `run` names with -w or --workspace, by path or package name. */
function workspaceOf(top, project, run) {
	const at = run.findIndex((arg) => arg === "-w" || arg === "--workspace" || arg.startsWith("--workspace="));
	if (at === -1) return undefined;
	const name = run[at].startsWith("--workspace=") ? run[at].slice("--workspace=".length) : run[at + 1];
	if (!name) return undefined;
	const byPath = posix.normalize(posix.join(project, name));
	if (existsSync(join(top, byPath, "package.json"))) return byPath;
	const packages = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ":(glob)**/package.json"], { cwd: top, encoding: "utf8" }).split("\n").filter(Boolean);
	for (const file of packages) {
		try {
			if (JSON.parse(readFileSync(join(top, file), "utf8")).name === name) return posix.dirname(file);
		} catch {
			// A package.json that isn't JSON names no workspace.
		}
	}
	return undefined;
}

/** A stage's command line, as a reviewer would type it. */
const command = ({ run = [] }) => run.join(" ");
