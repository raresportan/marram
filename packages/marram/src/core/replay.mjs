import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { checkoutAt, repoPath, scratchFolder } from "./checkout.mjs";
import { spawnable } from "./command.mjs";
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

export function replay(root, config, args) {
	const [baseRef, file, name, assertion] = args;
	if (args.length !== 4 || args.some((value) => !value)) throw new Error("Usage: marram replay <base> <test-file> <test-name> <expected assertion message>");
	const setup = config.replay?.setup;
	if (setup !== undefined && (!Array.isArray(setup) || setup.length === 0 || !setup.every((part) => typeof part === "string" && part !== ""))) {
		throw new Error('replay.setup in marram.config.mjs must be a command and its arguments, as in ["npm", "ci"]');
	}
	// For the setup and for the test, on each side: one that hangs would otherwise hold replay forever.
	const timeoutMs = config.replay?.timeoutMs ?? 300_000;
	if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("replay.timeoutMs in marram.config.mjs must be a positive number of milliseconds");
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
			const result = spawnSync(run.file, run.args, { ...run.options, cwd, stdio: ["ignore", 2, 2], timeout: timeoutMs });
			if (result.error?.code === "ETIMEDOUT") return { state: "inconclusive", detail: `Setup didn't finish within ${timeoutMs} ms` };
			if (result.status !== 0) return { state: "inconclusive", detail: "Setup failed" };
		}
		return runNamedTest({ cwd, file: target, name, assertion, output: join(scratch, side + ".jsonl"), timeout: timeoutMs });
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
		console.log(JSON.stringify({ test: name, assertion, base: { revision: base, ...before }, candidate: { revision: candidate, ...after } }, null, 2));
		if (before.state !== "failed assertion" || after.state !== "passed") process.exitCode = 1;
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}
