import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const reporter = fileURLToPath(new URL("./replay-reporter.mjs", import.meta.url));
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
	const repo = git(root, "rev-parse", "--show-toplevel");
	const project = relative(repo, root);
	const path = relative(repo, resolve(root, file));
	if (path === ".." || path.startsWith(".." + sep)) throw new Error("The selected check must be inside the repository");
	const candidate = git(root, "rev-parse", "HEAD");
	const base = git(root, "rev-parse", "--verify", "--end-of-options", baseRef + "^{commit}");
	const check = execFileSync("git", ["show", candidate + ":" + path.split(sep).join("/")], { cwd: root });
	const scratch = mkdtempSync(join(tmpdir(), "marram-replay-"));
	const pattern = "^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$";

	function runCheck(revision, side) {
		const checkout = join(scratch, side);
		// A clone of its own, so setup can't touch the caller's refs, config or worktrees; --shared borrows the objects
		// instead of copying them.
		git(repo, "clone", "-q", "--shared", "--no-checkout", "--", repo, checkout);
		git(checkout, "-c", "core.hooksPath=/dev/null", "-c", "advice.detachedHead=false", "checkout", "-q", "--detach", revision);
		const cwd = join(checkout, project);
		const target = join(checkout, path);
		if (!staysInside(checkout, dirname(target))) throw new Error("Test directory points outside checkout");
		mkdirSync(dirname(target), { recursive: true });
		rmSync(target, { force: true });
		writeFileSync(target, check);
		if (setup) {
			const result = spawnSync(setup[0], setup.slice(1), { cwd, stdio: ["ignore", 2, 2] });
			if (result.status !== 0) return { state: "inconclusive", detail: "Setup failed" };
		}
		const output = join(scratch, side + ".jsonl");
		const run = spawnSync(process.execPath, ["--test", "--test-reporter", reporter, "--test-reporter-destination", output, "--test-name-pattern", pattern, target], { cwd, stdio: ["ignore", 2, 2] });
		const rows = readFileSync(output, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
		const selected = rows.filter((row) => row.name === name && !row.skipped);
		if (selected.length === 1) {
			const row = selected[0];
			if (row.passed && run.status === 0) return { state: "passed", detail: name };
			if (run.status === 1 && row.code === "ERR_ASSERTION" && row.message?.split("\n")[0] === assertion) return { state: "failed assertion", detail: row.message };
			if (row.failureType === "subtestsFailed") return { state: "inconclusive", detail: `"${name}" is a suite: name the test inside it that makes the assertion` };
		}
		return { state: "inconclusive", detail: rows.find((row) => row.message)?.message ?? "Selected test did not produce one completed result" };
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
