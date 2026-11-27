// What's missing or wrong in a project's Marram setup, each with what to do about it. Usage: marram doctor
//
// It reads the setup, not the code: the config (all of it, as every command checks it), whether each tier runs
// something and each stage's command is there to run, whether the gate's logs are kept out of Git, whether git runs the
// hooks that gate a push and check review fixes, and whether the files the config names exist. A problem exits 1; a
// warning is something the project may mean, such as no full tier, and doesn't.
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { classesIn } from "./commit-lint.mjs";
import { locate } from "./command.mjs";
import { findRoot, importConfig, problems } from "./config.mjs";

// The Marram a hook runs, named from the repository's top as init writes it: node_modules/… or app/node_modules/….
const INSTALLED = /\$\(git rev-parse --show-toplevel\)\/([^\s"'`$]*node_modules\/@raresportan\/marram\/bin\/marram\.mjs)/g;

/** `git args` from `cwd`, trimmed, or undefined when git fails. */
function git(cwd, ...args) {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return undefined;
	}
}

/** Whether `file` can be run as a program: always on Windows, which goes by its extension. */
function runnable(file) {
	if (process.platform === "win32") return true;
	try {
		accessSync(file, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * The findings on the project around `from`, as `{ level: "ok" | "warning" | "problem", text }`, in the order they're
 * checked.
 */
export async function diagnose(from = process.cwd()) {
	const findings = [];
	const ok = (text) => findings.push({ level: "ok", text });
	const warning = (text) => findings.push({ level: "warning", text });
	const problem = (text) => findings.push({ level: "problem", text });

	const root = findRoot(from);
	if (root === undefined) {
		problem(`No marram.config.mjs in ${resolve(from)} or above it: \`marram init\` writes one`);
		return findings;
	}
	let config;
	try {
		config = await importConfig(root);
	} catch (error) {
		problem(`marram.config.mjs doesn't load: ${error.message}`);
		return findings;
	}
	const wrong = problems(config);
	if (wrong.length > 0) {
		for (const text of wrong) problem(`marram.config.mjs: ${text}`);
		return findings;
	}
	ok(`marram.config.mjs (${root})`);

	const tiers = config.gate?.tiers ?? {};
	for (const tier of ["fast", "default", "full"]) {
		const command = tier === "default" ? "marram gate" : `marram gate ${tier}`;
		if (!Array.isArray(tiers[tier])) (tier === "default" ? problem : warning)(`gate.tiers.${tier} isn't set: \`${command}\` refuses to run`);
		else if (tiers[tier].length === 0) (tier === "default" ? problem : warning)(`gate.tiers.${tier} runs nothing: \`${command}\` passes without checking anything`);
	}
	const stages = Object.values(tiers).filter(Array.isArray).flat();
	const missing = [...new Set(stages.map((stage) => stage.run[0]))].filter((command) => locate(command, { cwd: root }) === undefined);
	for (const command of missing) {
		const names = [...new Set(stages.filter((stage) => stage.run[0] === command).map((stage) => stage.name))].join(", ");
		problem(`${command} isn't on PATH, or a file from ${root}, so the stage${names.includes(",") ? "s" : ""} ${names} can't run`);
	}
	if (stages.length > 0 && missing.length === 0) ok("each stage's command is there to run");

	const top = git(root, "rev-parse", "--show-toplevel");
	if (top === undefined) {
		problem("Not in a Git repository: the gate's verdicts and the hooks need one (`git init`)");
		return findings;
	}
	const logs = config.gate?.logs ?? ".verify";
	// A path under the folder, since a pattern such as `.verify/` matches only once it exists.
	if (git(root, "check-ignore", "-q", `${logs}/gate-default-run`) === undefined) problem(`${logs}/ isn't ignored by Git: add it to .gitignore, or each run's logs show up as changes`);
	else ok(`${logs}/ is ignored by Git`);

	// From the top, so it's named from there: core.hooksPath, or .git/hooks.
	const named = git(top, "rev-parse", "--git-path", "hooks");
	const hooks = resolve(top, named);
	const shown = named.split("\\").join("/");
	/**
	 * The hook `name`: its text, or undefined when there's none; and whether it can run, as git runs it and with the
	 * Marram it names (a path from the repository's top, such as app/node_modules/…) installed.
	 */
	const hook = (name) => {
		const file = join(hooks, name);
		if (!existsSync(file)) return { text: undefined, sound: false };
		const text = readFileSync(file, "utf8");
		let sound = true;
		if (!runnable(file)) {
			problem(`${shown}/${name} isn't executable, so git skips it: \`chmod +x ${shown}/${name}\``);
			sound = false;
		}
		for (const [, path] of text.matchAll(INSTALLED)) {
			if (existsSync(join(top, path))) continue;
			problem(`${shown}/${name} runs ${path}, which isn't installed: \`npm install\``);
			sound = false;
		}
		return { text, sound };
	};
	const prePush = hook("pre-push");
	if (!/\bhook pre-push\b/.test(prePush.text ?? "")) {
		const set = git(root, "config", "core.hooksPath") === undefined ? " (core.hooksPath isn't set)" : "";
		problem(`No pre-push hook in ${shown}${set} runs \`marram hook pre-push\`, so a push isn't gated: \`marram init\` writes one`);
	} else if (prePush.sound) ok(`${shown}/pre-push gates a push`);
	const commitMsg = hook("commit-msg");
	const lintsCommits = /\bcommit-lint\b/.test(commitMsg.text ?? "");
	if (config.review !== undefined && !lintsCommits) warning(`No commit-msg hook in ${shown} runs \`marram commit-lint "$1"\`, so a review fix's classes and rungs are checked only by CI, if at all`);
	if (config.review !== undefined && lintsCommits && commitMsg.sound) ok(`${shown}/commit-msg checks a review fix's classes and rungs`);
	if (config.review === undefined && lintsCommits) problem(`${shown}/commit-msg runs commit-lint, but marram.config.mjs has no review.classes for it to check against`);
	if (config.review !== undefined) {
		const doc = join(root, config.review.classes);
		if (!existsSync(doc)) problem(`review.classes is ${config.review.classes}, which doesn't exist`);
		else if (classesIn(readFileSync(doc, "utf8")).length === 0) problem(`${config.review.classes} lists no classes: its table rows start with | **<name>**`);
		else ok(`${config.review.classes} lists the mistake classes`);
	}

	for (const fault of config.probes?.faults ?? []) {
		if (!existsSync(join(root, fault.patch))) problem(`probe "${fault.name}": its patch, ${fault.patch}, doesn't exist`);
	}
	return findings;
}

const MARKS = { ok: "✓", warning: "!", problem: "✗" };

export async function doctor(from = process.cwd()) {
	const findings = await diagnose(from);
	for (const { level, text } of findings) console.log(`${MARKS[level]} ${text}`);
	const count = findings.filter((finding) => finding.level === "problem").length;
	console.log(count === 0 ? "\nNothing to fix." : `\n${count} problem(s) to fix.`);
	if (count > 0) process.exit(1);
}
