import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { checkoutAt, repoPath, scratchFolder } from "./checkout.mjs";
import { runBounded } from "./bounded.mjs";
import { spawnable } from "./command.mjs";
import { replayProblems } from "./config.mjs";
import { outputExcerpt } from "./failure-excerpt.mjs";
import { runNamedTest } from "./node-test.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trimEnd();

/** Whether `path`, once its existing part's symlinks are resolved, stays inside `folder`. Checked before creating anything. */
function staysInside(folder, path) {
	let existing = path;
	while (!existsSync(existing)) existing = dirname(existing);
	const real = join(realpathSync(existing), relative(existing, path));
	const offset = relative(realpathSync(folder), real);
	return offset !== ".." && !offset.startsWith(".." + sep);
}

const USAGE = 'Usage: marram replay <base> <test-file> <test-name> <expected assertion message>, or for any test runner: marram replay <base> <test-file> --expect "<output text>" -- <command> [args]…';

/**
 * What `args` ask: `{ baseRef, file, name, assertion }` for a node:test test, or `{ baseRef, file, run, expect }` for a
 * command that runs the test with any runner (`-- npx vitest run test/a.test.ts -t "reads one"`), whose output on the
 * base must contain `expect`.
 */
function parse(args) {
	const split = args.indexOf("--");
	if (split === -1) {
		const [baseRef, file, name, assertion] = args;
		// --expect without the command it's for: not a test named "--expect".
		if (args.length !== 4 || args.some((value) => !value) || args.includes("--expect")) throw new Error(USAGE);
		return { baseRef, file, name, assertion };
	}
	const before = args.slice(0, split);
	const run = args.slice(split + 1);
	const flag = before.indexOf("--expect");
	const expect = flag === -1 ? undefined : before[flag + 1];
	if (flag !== -1) before.splice(flag, 2);
	const [baseRef, file] = before;
	if (before.length !== 2 || !baseRef || !file || !expect || run.length === 0 || !run[0]) throw new Error(USAGE);
	return { baseRef, file, run, expect };
}

export function replay(root, config, args) {
	const { baseRef, file, name, assertion, run: command, expect } = parse(args);
	const [problem] = replayProblems(config.replay ?? {});
	if (problem !== undefined) throw new Error(problem);
	const setup = config.replay?.setup;
	// For the setup and for the test, on each side: one that hangs would otherwise hold replay forever.
	const timeoutMs = config.replay?.timeoutMs ?? 300_000;
	const repo = git(root, "rev-parse", "--show-toplevel");
	const project = repoPath(root);
	const path = repoPath(root, file);
	if (path === ".." || path.startsWith("../")) throw new Error("The selected check must be inside the repository");
	const candidate = git(root, "rev-parse", "HEAD");
	const base = git(root, "rev-parse", "--verify", "--end-of-options", baseRef + "^{commit}");
	const check = execFileSync("git", ["show", `${candidate}:${path}`], { cwd: root });
	const scratch = scratchFolder("marram-replay-");

	function runCheck(revision, side) {
		const checkout = join(scratch, side);
		checkoutAt(repo, revision, checkout);
		const cwd = join(checkout, project);
		const target = join(checkout, path);
		if (!staysInside(checkout, dirname(target))) throw new Error("Test directory points outside checkout");
		mkdirSync(dirname(target), { recursive: true });
		rmSync(target, { force: true });
		writeFileSync(target, check);
		if (setup) {
			const run = spawnable(setup[0], setup.slice(1), { cwd });
			const result = runBounded(run.file, run.args, { ...run.options, cwd, timeout: timeoutMs });
			if (result.error?.code === "ETIMEDOUT") return { state: "inconclusive", detail: `Setup didn't finish within ${timeoutMs} ms` };
			if (result.status !== 0) return { state: "inconclusive", detail: "Setup failed" };
		}
		if (command === undefined) return runNamedTest({ cwd, file: target, name, assertion, output: join(scratch, side + ".jsonl"), timeout: timeoutMs });
		return runCommand(cwd);
	}

	/**
	 * The command's verdict from `cwd`: "passed" when it exits 0, "failed as expected" when it fails with `expect` in its
	 * output, else inconclusive. It should run the one test: any other failing would leave the failure not only its.
	 */
	function runCommand(cwd) {
		const run = spawnable(command[0], command.slice(1), { cwd });
		const result = runBounded(run.file, run.args, { ...run.options, cwd, timeout: timeoutMs, capture: true });
		const output = result.stdout + result.stderr;
		if (result.error?.code === "ETIMEDOUT") return { state: "inconclusive", detail: `The test didn't finish within ${timeoutMs} ms` };
		if (result.error || result.status === null) return { state: "inconclusive", detail: result.error?.message ?? "The test didn't finish" };
		if (result.status === 0) return { state: "passed", detail: outputExcerpt(output) };
		if (output.includes(expect)) return { state: "failed as expected", detail: outputExcerpt(output) };
		return { state: "inconclusive", detail: `It failed, but its output doesn't contain "${expect}": ${outputExcerpt(output)}` };
	}

	function observe(revision, side) {
		try {
			return runCheck(revision, side);
		} catch (error) {
			return { state: "inconclusive", detail: error.message };
		}
	}

	try {
		const before = observe(base, "base");
		const after = observe(candidate, "candidate");
		const asked = command === undefined ? { test: name, assertion } : { file, command, expect };
		console.log(JSON.stringify({ ...asked, base: { revision: base, ...before }, candidate: { revision: candidate, ...after } }, null, 2));
		const failed = command === undefined ? "failed assertion" : "failed as expected";
		if (before.state !== failed || after.state !== "passed") process.exitCode = 1;
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}
