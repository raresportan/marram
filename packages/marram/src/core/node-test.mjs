// One node:test test, run on its own, and how it ended: it passed, it failed at the named assertion, or neither (it
// was skipped, it failed some other way, or it's a suite rather than a test). Shared by replay and probe.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { runBounded } from "./bounded.mjs";

// As a URL: run in the runner's process, the reporter and the test file are loaded with import(), which takes a
// Windows path (D:\…) for a URL with a "d:" scheme.
const reporter = new URL("./replay-reporter.mjs", import.meta.url).href;

let isolation;
/**
 * The flag that runs the test file in the runner's own process, so stopping the runner at a timeout stops the test
 * too: Windows ends only the process it's told to, not one it started. Node 23 renamed it from its experimental name.
 */
function inRunner() {
	isolation ??= spawnSync(process.execPath, ["--test-isolation=none", "-e", ""]).status === 0 ? "--test-isolation=none" : "--experimental-test-isolation=none";
	return isolation;
}

/**
 * Run the test called `name` in `file` from `cwd`, writing its observations to `output`. `{ state, detail }`, where
 * state is "passed", "failed assertion" (its first message line is `assertion`) or "inconclusive".
 */
export function runNamedTest({ cwd, file, name, assertion, output, timeout }) {
	const pattern = "^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$";
	const target = isAbsolute(file) ? relative(cwd, file) : file;
	const run = runBounded(process.execPath, ["--test", inRunner(), "--test-reporter", reporter, "--test-reporter-destination", output, "--test-name-pattern", pattern, target], { cwd, timeout });
	if (run.error?.code === "ETIMEDOUT") return { state: "inconclusive", detail: `The test didn't finish within ${timeout} ms` };
	if (run.error || run.status === null) return { state: "inconclusive", detail: run.error?.message ?? "The test didn't finish" };
	const rows = existsSync(output) ? readFileSync(output, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
	const selected = rows.filter((row) => row.name === name && !row.skipped);
	if (selected.length === 1) {
		const row = selected[0];
		if (row.passed && run.status === 0) return { state: "passed", detail: name };
		if (run.status === 1 && row.code === "ERR_ASSERTION" && row.message?.split("\n")[0] === assertion) return { state: "failed assertion", detail: row.message };
		if (row.failureType === "subtestsFailed") return { state: "inconclusive", detail: `"${name}" is a suite: name the test inside it that makes the assertion` };
	}
	return { state: "inconclusive", detail: rows.find((row) => row.message)?.message ?? "Selected test did not produce one completed result" };
}
