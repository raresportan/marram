// Sets a project up for Marram, from the folder it runs in. Usage: marram init
//
// It writes what's missing and leaves what's there alone:
//   - marram.config.mjs, its tiers from the package.json scripts it finds (typecheck and lint for fast, then test),
//     or empty for the project to fill;
//   - the gate's logs (.verify) in .gitignore;
//   - a pre-push hook that runs `marram hook pre-push`, in core.hooksPath, which is set to .githooks when it isn't set
//     and git has no hooks of its own in use there.
// A review section and its commit-msg hook need the project's mistake classes, so they're left to the project.
// `marram doctor` says what's still missing.
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BIN = "node_modules/@raresportan/marram/bin/marram.mjs";
const FAST = ["typecheck", "lint"];
const DEFAULT = ["test"];

/** `git args` from `cwd`, trimmed, or undefined when git fails. */
function git(cwd, ...args) {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return undefined;
	}
}

const posix = (path) => path.split("\\").join("/");

/** marram.config.mjs's text, with the tiers of `scripts` (package.json's) that it knows. */
export function configText(scripts = {}) {
	const has = (names) => names.filter((name) => typeof scripts[name] === "string");
	const fast = has(FAST);
	const more = has(DEFAULT);
	if (fast.length + more.length === 0) {
		return [
			"// Each tier is a list of stages, { name, run: [command, ...args] }, run in order: fast for each edit, default before",
			"// work counts as done (and a push), full before merging. `marram doctor` checks it.",
			"export default {",
			'\tgate: { logs: ".verify", tiers: { fast: [], default: [], full: [] } },',
			"};",
			"",
		].join("\n");
	}
	const list = (names) => names.map((name) => `npm("${name}")`).join(", ");
	const fastList = `const fast = [${list(fast)}];`;
	const defaultList = `const checks = [...fast${more.length > 0 ? `, ${list(more)}` : ""}];`;
	return [
		"// Each tier is a list of stages, { name, run: [command, ...args] }, run in order: fast for each edit, default before",
		"// work counts as done (and a push), full before merging. `marram doctor` checks it.",
		'const npm = (script) => ({ name: script, run: ["npm", "run", script] });',
		fastList,
		defaultList,
		"",
		"export default {",
		'\tgate: { logs: ".verify", tiers: { fast, default: checks, full: checks } },',
		"};",
		"",
	].join("\n");
}

/** The pre-push hook's text, for a project at `project` from the repository's top, with Marram installed at `bin`. */
export function hookText(project, bin) {
	return [
		"#!/bin/sh",
		...(project === "" ? [] : [`cd "$(git rev-parse --show-toplevel)/${project}" || exit 1`]),
		`exec node "$(git rev-parse --show-toplevel)/${bin}" hook pre-push`,
		"",
	].join("\n");
}

/**
 * Where Marram is installed for the project at `root`, from the repository's top: the nearest node_modules that has it,
 * from the project's folder up to the top. `prefix` is the project's folder from the top, as git names it.
 */
function installed(root, prefix) {
	const folders = prefix.split("/").filter(Boolean);
	for (let up = 0; up <= folders.length; up++) {
		if (existsSync(join(root, ...Array(up).fill(".."), BIN))) return [...folders.slice(0, folders.length - up), BIN].join("/");
	}
	return undefined;
}

/** Sets up the project at `from`; returns what it did and what it left, one line each. */
export function setUp(from = process.cwd()) {
	const root = resolve(from);
	const done = [];
	const config = join(root, "marram.config.mjs");
	if (existsSync(config)) done.push("marram.config.mjs is already there: left as it is");
	else {
		const pkg = join(root, "package.json");
		const scripts = existsSync(pkg) ? JSON.parse(readFileSync(pkg, "utf8")).scripts : undefined;
		const text = configText(scripts);
		writeFileSync(config, text);
		done.push(text.includes("fast: []") ? "wrote marram.config.mjs with empty tiers: add the checks your project runs" : "wrote marram.config.mjs, its tiers from package.json's scripts");
	}

	const top = git(root, "rev-parse", "--show-toplevel");
	if (top === undefined) {
		done.push("not in a Git repository, so no hooks or .gitignore: `git init`, then run `marram init` again");
		return done;
	}
	if (git(root, "check-ignore", "-q", ".verify/gate-default-run") === undefined) {
		const ignore = join(root, ".gitignore");
		const before = existsSync(ignore) ? readFileSync(ignore, "utf8") : "";
		appendFileSync(ignore, `${before === "" || before.endsWith("\n") ? "" : "\n"}.verify/\n`);
		done.push("added .verify/ to .gitignore");
	}

	const set = git(root, "config", "core.hooksPath");
	let hooks;
	if (set !== undefined) hooks = resolve(top, set);
	else {
		const own = resolve(top, git(top, "rev-parse", "--git-path", "hooks"));
		const inUse = existsSync(own) ? readdirSync(own).filter((name) => !name.endsWith(".sample")) : [];
		if (inUse.length > 0) {
			done.push(`git runs hooks from ${own} (${inUse.join(", ")}), so core.hooksPath is left unset: add \`marram hook pre-push\` to its pre-push yourself`);
			return done;
		}
		hooks = join(top, ".githooks");
		git(top, "config", "core.hooksPath", ".githooks");
		done.push("set core.hooksPath to .githooks");
	}
	const shown = posix(set ?? ".githooks");
	const prePush = join(hooks, "pre-push");
	if (existsSync(prePush)) {
		const runs = /\bhook pre-push\b/.test(readFileSync(prePush, "utf8"));
		done.push(runs ? `${shown}/pre-push already gates a push` : `${shown}/pre-push is already there and doesn't run \`marram hook pre-push\`: add it yourself`);
	} else {
		// The project's folder from the top as git names it: a path between `top` and `root` can't be trusted, since
		// Windows may name the same folder two ways (RUNNER~1).
		const prefix = git(root, "rev-parse", "--show-prefix").replace(/\/$/, "");
		const bin = installed(root, prefix);
		mkdirSync(hooks, { recursive: true });
		writeFileSync(prePush, hookText(prefix, bin ?? BIN));
		chmodSync(prePush, 0o755);
		done.push(`wrote ${shown}/pre-push, which gates a push`);
		if (bin === undefined) done.push("Marram isn't installed here yet, which the hook needs: `npm install --save-dev @raresportan/marram`");
	}
	return done;
}

export function init(from = process.cwd()) {
	for (const line of setUp(from)) console.log(`- ${line}`);
	console.log("\nNext: `marram doctor` checks the setup, and `marram gate` runs the default gate.");
}
