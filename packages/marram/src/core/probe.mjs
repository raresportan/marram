// Does the gate still catch the defects it was built to catch? Usage: marram probe [fault name]…
// Each fault in `probes.faults` is a patch that puts a known defect back, and the check that must catch it. In a
// disposable copy of the working tree (uncommitted changes included, as the gate sees it), the check runs clean and must
// pass, then runs with the patch applied and must fail for the reason given. A fault the check passes with is missed:
// that defect can pass the gate again. One that can't be judged (the clean run fails, the patch no longer applies, the
// check fails some other way) is inconclusive. Exits 1 unless every fault is caught.
//
//   probes: {
//     setup: ["npm", "ci"],          // optional: run once in the copy, before the faults
//     link: ["node_modules"],        // optional: ignored paths shared from the working tree rather than rebuilt
//     timeoutMs: 300000,             // optional: for each command
//     faults: [
//       { name, patch: "probes/no-rollback.patch", run: ["pytest", "tests/test_tx.py"], expect: /balance unchanged/ },
//       { name, patch, test: { file: "test/tx.test.mjs", name: "rolls back", assertion: "balance unchanged" } },
//     ],
//   }
//
// Paths are the project's, and so is where commands run unless a fault gives `cwd`. A patch is `git diff` output, applied
// at the repository root. `expect` is a RegExp, or a string the output must contain. A `test` fault is node:test's, judged
// as replay judges it: the named test passes clean, and fails with the patch at the assertion with that message.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { checkoutTree } from "./checkout.mjs";
import { treeOf } from "./gate-state.mjs";
import { runNamedTest } from "./node-test.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
const isCommand = (value) => Array.isArray(value) && value.length > 0 && value.every((part) => typeof part === "string" && part !== "");

export function probe(root, config, names) {
	const { setup, link = [], timeoutMs = 300_000, faults } = config.probes ?? {};
	const chosen = choose(faults, names);
	if (setup !== undefined && !isCommand(setup)) throw new Error('probes.setup must be a command and its arguments, as in ["npm", "ci"]');
	if (!Array.isArray(link) || !link.every((path) => typeof path === "string" && path !== "")) throw new Error("probes.link must be a list of paths");
	const repo = git(root, "rev-parse", "--show-toplevel");
	const scratch = mkdtempSync(join(tmpdir(), "marram-probe-copy-"));
	const forget = () => rmSync(scratch, { recursive: true, force: true });
	const signals = ["SIGINT", "SIGTERM"].map((signal) => {
		const stop = () => {
			forget();
			process.exit(128 + (signal === "SIGINT" ? 2 : 15));
		};
		process.once(signal, stop);
		return [signal, stop];
	});
	try {
		const copy = join(scratch, "copy");
		checkoutTree(repo, treeOf(root), copy);
		const project = join(copy, relative(repo, root));
		for (const path of link) {
			const target = join(project, path);
			if (existsSync(target)) throw new Error(`probes.link: ${path} is in the working tree, and only an ignored path can be linked`);
			mkdirSync(dirname(target), { recursive: true });
			symlinkSync(resolve(root, path), target);
		}
		if (setup !== undefined) {
			const result = command(project, setup, timeoutMs);
			if (result.status !== 0) throw new Error(`probes.setup failed: ${result.error?.message ?? excerpt(result.output)}`);
		}
		const verdicts = chosen.map((fault) => {
			const started = Date.now();
			const verdict = judge(root, copy, project, fault, timeoutMs, join(scratch, "observations.jsonl"));
			const line = { caught: `✓ ${fault.name}: caught (${Date.now() - started} ms)`, missed: `✗ ${fault.name}: missed: the check passed with the fault in place`, inconclusive: `? ${fault.name}: inconclusive: ${verdict.detail}` }[verdict.state];
			console.log(line);
			return { name: fault.name, ...verdict };
		});
		const caught = verdicts.filter((verdict) => verdict.state === "caught").length;
		const missed = verdicts.filter((verdict) => verdict.state === "missed").map((verdict) => verdict.name);
		console.log(`${caught}/${verdicts.length} faults caught${missed.length > 0 ? `. Missed: ${missed.join(", ")}` : ""}`);
		if (caught !== verdicts.length) process.exitCode = 1;
	} finally {
		for (const [signal, stop] of signals) process.off(signal, stop);
		forget();
	}
}

/** The faults `names` picks (all of them when it's empty), each checked for what a fault needs. */
function choose(faults, names) {
	if (!Array.isArray(faults) || faults.length === 0) throw new Error("marram.config.mjs has no probes.faults");
	faults.forEach((fault, i) => {
		const label = `probes.faults[${i}]${typeof fault?.name === "string" ? ` ("${fault.name}")` : ""}`;
		if (typeof fault?.name !== "string" || fault.name === "") throw new Error(`${label} needs a name`);
		if (typeof fault.patch !== "string" || fault.patch === "") throw new Error(`${label} needs a patch`);
		const byCommand = isCommand(fault.run) && (fault.expect instanceof RegExp || (typeof fault.expect === "string" && fault.expect !== ""));
		const byTest = ["file", "name", "assertion"].every((key) => typeof fault.test?.[key] === "string" && fault.test[key] !== "");
		if (byCommand === byTest) throw new Error(`${label} needs either run and expect, or test: { file, name, assertion }`);
		if (faults.findIndex((other) => other.name === fault.name) !== i) throw new Error(`${label}: another fault has that name`);
	});
	for (const name of names) if (!faults.some((fault) => fault.name === name)) throw new Error(`No fault named "${name}" in probes.faults`);
	return names.length === 0 ? faults : faults.filter((fault) => names.includes(fault.name));
}

/** `{ state, detail }`: caught, missed or inconclusive. The patch is taken back out before this returns. */
function judge(root, copy, project, fault, timeoutMs, observations) {
	const cwd = join(project, fault.cwd ?? ".");
	const check = () => {
		if (fault.test) {
			rmSync(observations, { force: true });
			const result = runNamedTest({ cwd, file: fault.test.file, name: fault.test.name, assertion: fault.test.assertion, output: observations, timeout: timeoutMs });
			return { ...result, state: { passed: "passed", "failed assertion": "expected" }[result.state] ?? "other" };
		}
		const result = command(cwd, fault.run, timeoutMs);
		if (result.error || result.status === null) return { state: "other", detail: result.error?.message ?? "the check didn't finish" };
		if (result.status === 0) return { state: "passed" };
		const expected = fault.expect instanceof RegExp ? fault.expect.test(result.output) : result.output.includes(fault.expect);
		return { state: expected ? "expected" : "other", detail: excerpt(result.output) };
	};
	const clean = check();
	if (clean.state !== "passed") return { state: "inconclusive", detail: `the check fails without the fault: ${clean.detail}` };
	const patch = resolve(root, fault.patch);
	// Each file's times too, put back with the file: a build tool that compares them would otherwise take the next
	// fault's copy for one whose sources changed since it was built.
	const touched = spawnSync("git", ["apply", "--numstat", "-z", patch], { cwd: copy, encoding: "utf8" }).stdout?.split("\0").filter(Boolean).map((row) => row.split("\t")[2]) ?? [];
	const times = touched.filter((file) => existsSync(join(copy, file))).map((file) => [join(copy, file), statSync(join(copy, file))]);
	const applied = spawnSync("git", ["apply", "--whitespace=nowarn", patch], { cwd: copy, encoding: "utf8" });
	if (applied.status !== 0) return { state: "inconclusive", detail: `the patch no longer applies: ${(applied.stderr || applied.error?.message || "").trim().split("\n")[0]}` };
	let faulty;
	try {
		faulty = check();
	} finally {
		// What the next fault runs against must be the clean copy again.
		execFileSync("git", ["apply", "-R", "--whitespace=nowarn", patch], { cwd: copy, stdio: "ignore" });
		for (const [file, { atimeMs, mtimeMs }] of times) utimesSync(file, atimeMs / 1000, mtimeMs / 1000);
	}
	if (faulty.state === "passed") return { state: "missed" };
	if (faulty.state === "expected") return { state: "caught" };
	return { state: "inconclusive", detail: `failed, but not as expected: ${faulty.detail}` };
}

/** Run `run` from `cwd`: `{ status, error?, output }`, with stdout and stderr together. */
function command(cwd, [program, ...args], timeout) {
	const result = spawnSync(program, args, { cwd, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
	return { status: result.status, error: result.error, output: (result.stdout ?? "") + (result.stderr ?? "") };
}

/** The last lines of `output` worth showing: not blank, not a stack frame, not npm's report that its command failed. */
const NOISE = /^\s*$|^\s+at |^Node\.js v|^npm (error|ERR!)/;
const excerpt = (output) => output.split("\n").filter((line) => !NOISE.test(line)).slice(-3).map((line) => line.trim()).join(" ⏎ ") || "(no output)";
