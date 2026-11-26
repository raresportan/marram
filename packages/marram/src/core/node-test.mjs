// One node:test test, run on its own, and how it ended: it passed, it failed at the named assertion, or neither (it
// was skipped, it failed some other way, or it's a suite rather than a test). Shared by replay and probe.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const reporter = fileURLToPath(new URL("./replay-reporter.mjs", import.meta.url));

/**
 * Run the test called `name` in `file` from `cwd`, writing its observations to `output`. `{ state, detail }`, where
 * state is "passed", "failed assertion" (its first message line is `assertion`) or "inconclusive".
 */
export function runNamedTest({ cwd, file, name, assertion, output, timeout }) {
	const pattern = "^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$";
	const run = spawnSync(process.execPath, ["--test", "--test-reporter", reporter, "--test-reporter-destination", output, "--test-name-pattern", pattern, file], { cwd, stdio: ["ignore", 2, 2], timeout });
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
