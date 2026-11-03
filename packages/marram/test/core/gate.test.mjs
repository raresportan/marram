// The gate running a real stage: a failure counts unless the machine slept during it.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const BIN = new URL("../../bin/marram.mjs", import.meta.url).pathname;
const GAP_MS = 2500;

// Each run takes its turn from the plan: `pause` stops the gate past the gap and wakes it again, standing in for sleep.
const STAGE = `
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const runs = existsSync("runs") ? readFileSync("runs", "utf8").length : 0;
appendFileSync("runs", ".");
const turn = process.argv[2].split(",")[runs];
console.log("run " + runs);
if (turn.startsWith("pause")) {
	spawn("sh", ["-c", "sleep ${(GAP_MS + 500) / 1000}; kill -CONT " + process.ppid], { detached: true, stdio: "ignore" }).unref();
	process.kill(process.ppid, "SIGSTOP");
}
process.exit(turn.endsWith("ok") ? 0 : 1);
`;

async function gate(plan) {
	const root = mkdtempSync(join(tmpdir(), "marram-gate-"));
	try {
		writeFileSync(join(root, "stage.mjs"), STAGE);
		writeFileSync(join(root, "marram.config.mjs"), `export default { gate: { logs: "logs", sleepGapMs: ${GAP_MS}, tiers: { fast: [{ name: "stage", run: ["node", "stage.mjs", "${plan}"] }] } } };`);
		const child = spawn("node", [BIN, "gate", "fast"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		child.stdout.on("data", (chunk) => { output += chunk; });
		child.stderr.on("data", (chunk) => { output += chunk; });
		const code = await new Promise((done) => child.on("exit", done));
		const dir = /Logs: (.+)/.exec(output)[1];
		return {
			code,
			output,
			runs: readFileSync(join(root, "runs"), "utf8").length,
			logs: { stage: readFileSync(join(dir, "stage.log"), "utf8"), slept: existsSync(join(dir, "stage-slept.log")) ? readFileSync(join(dir, "stage-slept.log"), "utf8") : undefined },
			report: JSON.parse(readFileSync(join(dir, "report.json"), "utf8")),
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("a stage that failed while the machine slept runs again, and its pass counts", async () => {
	const { code, output, runs, logs, report } = await gate("pause-fail,ok");
	assert.equal(code, 0, output);
	assert.equal(runs, 2);
	assert.match(output, /The machine slept for \ds during stage, so its failure says nothing about the code/);
	assert.match(logs.slept, /run 0/);
	assert.match(logs.stage, /run 1/);
	assert.equal(report.passed, true);
	assert.deepEqual(report.stages.map((stage) => stage.code), [1, 0]);
});

test("a stage that fails again with no sleep fails the gate", async () => {
	const { code, output, runs } = await gate("pause-fail,fail");
	assert.equal(code, 1, output);
	assert.equal(runs, 2);
	assert.match(output, /Gate failed at stage/);
});

test("a failure with no sleep isn't run again", async () => {
	const { code, output, runs } = await gate("fail,ok");
	assert.equal(code, 1, output);
	assert.equal(runs, 1);
	assert.doesNotMatch(output, /slept/);
});

test("a stage that passed after a sleep isn't run again", async () => {
	const { code, output, runs } = await gate("pause-ok,fail");
	assert.equal(code, 0, output);
	assert.equal(runs, 1);
});
