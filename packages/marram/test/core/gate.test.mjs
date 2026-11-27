// The gate running a real stage: a failure counts unless the machine slept during it.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { groups, pruneLogs } from "../../src/core/gate.mjs";

const GATE = new URL("../../src/core/gate.mjs", import.meta.url).href;

const BIN = fileURLToPath(new URL("../../bin/marram.mjs", import.meta.url));
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
if (turn.endsWith("fail")) {
	console.error("not ok: expected the counter to persist");
	console.error("observed zero");
}
process.exit(turn.endsWith("ok") ? 0 : 1);
`;

// Sleep is stood in for with SIGSTOP and SIGCONT, which Windows doesn't have; the gate's own check, a gap between
// timer ticks, doesn't need them.
const PAUSES = { skip: process.platform === "win32" && "stands in for sleep with SIGSTOP, which Windows doesn't have" };

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

test("a stage that failed while the machine slept runs again, and its pass counts", PAUSES, async () => {
	const { code, output, runs, logs, report } = await gate("pause-fail,ok");
	assert.equal(code, 0, output);
	assert.equal(runs, 2);
	assert.match(output, /The machine slept for \ds during stage, so its failure says nothing about the code/);
	assert.match(logs.slept, /run 0/);
	assert.match(logs.stage, /run 1/);
	assert.equal(report.passed, true);
	assert.deepEqual(report.stages.map((stage) => stage.code), [1, 0]);
});

test("a stage that fails again with no sleep fails the gate", PAUSES, async () => {
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
	assert.match(output, /Gate failed at stage\.\s+not ok: expected the counter to persist\nobserved zero/);
});

test("a stage that passed after a sleep isn't run again", PAUSES, async () => {
	const { code, output, runs } = await gate("pause-ok,fail");
	assert.equal(code, 0, output);
	assert.equal(runs, 1);
});

test("only the newest runs' log folders are kept, whatever their tier, and nothing else in the folder is touched", async () => {
	const logs = mkdtempSync(join(tmpdir(), "marram-logs-"));
	try {
		const runs = Array.from({ length: 6 }, (_, i) => `gate-${["fast", "default", "full"][i % 3]}-2026-11-0${i + 1}T08-00-00-000Z`);
		for (const run of runs) mkdirSync(join(logs, run));
		for (const other of ["evidence", "gate-notes", "gate-full-yesterday"]) mkdirSync(join(logs, other));
		writeFileSync(join(logs, "gate-fast-2026-10-01T08-00-00-000Z"), "a file, not a run");
		await pruneLogs(logs, 4);
		assert.deepEqual(readdirSync(logs).sort(), [...runs.slice(2), "evidence", "gate-fast-2026-10-01T08-00-00-000Z", "gate-full-yesterday", "gate-notes"].sort());
		await pruneLogs(join(logs, "missing"), 1);
	} finally {
		rmSync(logs, { recursive: true, force: true });
	}
});

test("the gate keeps gate.keep runs' logs, its own among them", () => {
	const root = mkdtempSync(join(tmpdir(), "marram-keep-"));
	try {
		writeFileSync(join(root, "marram.config.mjs"), 'export default { gate: { logs: "logs", keep: 2, tiers: { fast: [{ name: "ok", run: ["node", "-e", ""] }] } } };');
		mkdirSync(join(root, "logs", "gate-full-2020-01-01T00-00-00-000Z"), { recursive: true });
		const dirs = [];
		for (let i = 0; i < 3; i++) {
			const result = spawnSync("node", [BIN, "gate", "fast"], { cwd: root, encoding: "utf8" });
			assert.equal(result.status, 0, result.stderr);
			dirs.push(/Logs: .*[\\/](gate-[^\\/\s]+)/.exec(result.stdout)[1]);
		}
		assert.deepEqual(readdirSync(join(root, "logs")).sort(), dirs.slice(1).sort());
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a run still going keeps its folder while another gate prunes, and one whose gate is gone doesn't", async () => {
	const root = mkdtempSync(join(tmpdir(), "marram-overlap-"));
	try {
		// With WAIT set, the stage waits for a file `go`, so its gate is still running when the next one prunes.
		// It gives up after 20s, so a test that fails before writing `go` doesn't leave it running.
		writeFileSync(join(root, "wait.mjs"), 'import { existsSync } from "node:fs";\nconst until = Date.now() + 20_000;\nwhile (process.env.WAIT && !existsSync("go")) {\n\tif (Date.now() > until) process.exit(1);\n\tawait new Promise((done) => setTimeout(done, 50));\n}\nconsole.log("done");\n');
		writeFileSync(join(root, "marram.config.mjs"), 'export default { gate: { logs: "logs", keep: 1, tiers: { fast: [{ name: "wait", run: ["node", "wait.mjs"] }] } } };');
		const first = spawn(process.execPath, [BIN, "gate", "fast"], { cwd: root, env: { ...process.env, WAIT: "1" }, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		first.stdout.on("data", (chunk) => { output += chunk; });
		first.stderr.on("data", (chunk) => { output += chunk; });
		const exited = new Promise((done) => first.on("exit", done));
		const logs = join(root, "logs");
		let firstRun;
		try {
			// Until its stage has started, unless the gate ends first or it takes past 20s.
			let ended = false;
			exited.then(() => { ended = true; });
			const until = Date.now() + 20_000;
			while (!(existsSync(logs) && readdirSync(logs).some((name) => existsSync(join(logs, name, "wait.log"))))) {
				assert.ok(!ended && Date.now() < until, `the first gate's stage never started:\n${output}`);
				await new Promise((done) => setTimeout(done, 50));
			}
			[firstRun] = readdirSync(logs);

			const second = spawnSync(process.execPath, [BIN, "gate", "fast"], { cwd: root, encoding: "utf8" });
			assert.equal(second.status, 0, second.stdout + second.stderr);
			assert.ok(existsSync(join(logs, firstRun)), "the running gate's folder is kept, though keep is 1");
			writeFileSync(join(root, "go"), "");
			assert.equal(await exited, 0, output);
			assert.equal(JSON.parse(readFileSync(join(logs, firstRun, "report.json"), "utf8")).passed, true);
			assert.ok(!existsSync(join(logs, firstRun, "running")), "a finished run is no longer marked");
		} finally {
			writeFileSync(join(root, "go"), "");
			first.kill();
			await exited;
		}

		// A gate that died left its marker: its process is gone, so the folder goes.
		const dead = spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" }).stdout.trim();
		writeFileSync(join(logs, firstRun, "running"), dead);
		await pruneLogs(logs, 1);
		assert.ok(!existsSync(join(logs, firstRun)), "a run whose gate is gone is pruned");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("gates starting in the same millisecond get folders of their own, and a folder a dead gate was making is pruned", async () => {
	const logs = mkdtempSync(join(tmpdir(), "marram-same-ms-"));
	try {
		const start = `import { startRun } from ${JSON.stringify(GATE)};\nconsole.log(await startRun(process.argv[1], "fast", new Date("2026-11-27T08:00:00.000Z")));`;
		const runs = await Promise.all([0, 1].map(() => new Promise((done) => {
			const child = spawn(process.execPath, ["--input-type=module", "-e", start, logs], { stdio: ["ignore", "pipe", "pipe"] });
			let output = "";
			child.stdout.on("data", (chunk) => { output += chunk; });
			child.stderr.on("data", (chunk) => { output += chunk; });
			child.on("exit", (code) => done({ code, output }));
		})));
		for (const run of runs) assert.equal(run.code, 0, run.output);
		const made = readdirSync(logs).sort();
		assert.equal(made.length, 2, made.join(", "));
		for (const name of made) assert.match(name, /^gate-fast-2026-11-27T08-00-00-000Z-\d+$/);

		const dead = spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" }).stdout.trim();
		const abandoned = `.gate-full-2026-11-27T09-00-00-000Z-${dead}`;
		const making = `.gate-full-2026-11-27T09-00-00-000Z-${process.pid}`;
		mkdirSync(join(logs, abandoned));
		mkdirSync(join(logs, making));
		await pruneLogs(logs, 20);
		assert.ok(!existsSync(join(logs, abandoned)), "a dead gate's half-made folder goes");
		assert.ok(existsSync(join(logs, making)), "a live gate's folder in the making stays");
	} finally {
		rmSync(logs, { recursive: true, force: true });
	}
});

// Unreadable files are a POSIX permission, which root ignores and Windows doesn't map.
const UNREADABLE = { skip: (process.platform === "win32" || process.getuid?.() === 0) && "needs a file its owner can't read" };

test("a run whose marker can't be read may still be going, so it's kept", UNREADABLE, async () => {
	const logs = mkdtempSync(join(tmpdir(), "marram-unreadable-"));
	const run = join(logs, "gate-default-2020-01-01T00-00-00-000Z");
	try {
		mkdirSync(run);
		writeFileSync(join(run, "running"), String(process.pid));
		chmodSync(join(run, "running"), 0o000);
		await pruneLogs(logs, 0);
		assert.ok(existsSync(run), "kept: whether its gate is running isn't known");
	} finally {
		if (existsSync(run)) chmodSync(join(run, "running"), 0o644);
		rmSync(logs, { recursive: true, force: true });
	}
});

test("without gate.logs, the gate's logs go in .verify", () => {
	const root = mkdtempSync(join(tmpdir(), "marram-logs-"));
	try {
		writeFileSync(join(root, "marram.config.mjs"), 'export default { gate: { tiers: { fast: [{ name: "ok", run: ["node", "-e", ""] }] } } };');
		const result = spawnSync("node", [BIN, "gate", "fast"], { cwd: root, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readdirSync(join(root, ".verify")).length, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("consecutive stages marked concurrent form one group; the rest run alone, in order", () => {
	const stage = (name, concurrent) => ({ name, run: ["true"], ...(concurrent === undefined ? {} : { concurrent }) });
	const names = (stages) => groups(stages).map((group) => group.map(({ name }) => name).join("+"));
	assert.deepEqual(names([stage("build"), stage("types", true), stage("rules", true), stage("unit", true), stage("journeys"), stage("a", true), stage("b", false), stage("c", true)]), ["build", "types+rules+unit", "journeys", "a", "b", "c"]);
});

// Each waits for the other's mark: run one after the other, the first would give up waiting and fail.
const MEET = `
import { existsSync, writeFileSync } from "node:fs";
const [mine, theirs] = process.argv.slice(2);
writeFileSync(mine, "");
const until = Date.now() + 10_000;
while (!existsSync(theirs) && Date.now() < until) await new Promise((done) => setTimeout(done, 50));
if (!existsSync(theirs)) { console.error("not ok: " + theirs + " never ran alongside"); process.exit(1); }
writeFileSync(mine + ".done", "");
`;

test("stages marked concurrent run at the same time, and the next stage waits for all of them", () => {
	const root = mkdtempSync(join(tmpdir(), "marram-gate-"));
	try {
		writeFileSync(join(root, "meet.mjs"), MEET);
		writeFileSync(join(root, "after.mjs"), 'import { existsSync } from "node:fs";\nprocess.exit(existsSync("a.done") && existsSync("b.done") ? 0 : 1);');
		const tiers = { fast: [
			{ name: "a", run: ["node", "meet.mjs", "a", "b"], concurrent: true },
			{ name: "b", run: ["node", "meet.mjs", "b", "a"], concurrent: true },
			{ name: "after", run: ["node", "after.mjs"] },
		] };
		writeFileSync(join(root, "marram.config.mjs"), `export default { gate: { logs: "logs", tiers: ${JSON.stringify(tiers)} } };`);
		const result = spawnSync(process.execPath, [BIN, "gate", "fast"], { cwd: root, encoding: "utf8" });
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /✓ after/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a failure in a concurrent group fails the gate at the first stage of it that failed, after the others finish", () => {
	const root = mkdtempSync(join(tmpdir(), "marram-gate-"));
	try {
		const tiers = { fast: [
			{ name: "slow", run: ["node", "-e", "setTimeout(() => {}, 500)"], concurrent: true },
			{ name: "broken", run: ["node", "-e", "process.exit(1)"], concurrent: true },
			{ name: "never", run: ["node", "-e", ""] },
		] };
		writeFileSync(join(root, "marram.config.mjs"), `export default { gate: { logs: "logs", tiers: ${JSON.stringify(tiers)} } };`);
		const result = spawnSync(process.execPath, [BIN, "gate", "fast"], { cwd: root, encoding: "utf8" });
		assert.equal(result.status, 1);
		assert.match(result.stdout, /✓ slow/);
		assert.match(result.stdout, /Gate failed at broken\./);
		assert.doesNotMatch(result.stdout, /never/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("with --json, the gate's report is JSON on stdout, passed or failed, and its lines go to stderr", () => {
	const root = mkdtempSync(join(tmpdir(), "marram-gate-"));
	const run = (tiers) => {
		writeFileSync(join(root, "marram.config.mjs"), `export default { gate: { logs: "logs", tiers: ${JSON.stringify(tiers)} } };`);
		return spawnSync(process.execPath, [BIN, "gate", "fast", "--json"], { cwd: root, encoding: "utf8" });
	};
	try {
		const passed = run({ fast: [{ name: "ok", run: ["node", "-e", ""] }] });
		assert.equal(passed.status, 0, passed.stdout + passed.stderr);
		const good = JSON.parse(passed.stdout);
		assert.deepEqual([good.tier, good.passed, good.stages.map(({ name, code }) => `${name} ${code}`)], ["fast", true, ["ok 0"]]);
		assert.match(passed.stderr, /✓ ok/);
		const failed = run({ fast: [{ name: "broken", run: ["node", "-e", "console.log('not ok: nope'); process.exit(3)"] }] });
		assert.equal(failed.status, 1);
		const bad = JSON.parse(failed.stdout);
		assert.deepEqual([bad.passed, bad.failedAt], [false, "broken"]);
		assert.match(bad.excerpt, /not ok: nope/);
		assert.ok(bad.log.endsWith("broken.log"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("with --json, a report bigger than a pipe holds reaches a reader that's slow to drain it whole, though the gate fails", { skip: process.platform === "win32" && "reads through sh" }, () => {
	const root = mkdtempSync(join(tmpdir(), "marram-gate-"));
	try {
		// Its excerpt (60 lines of 2000 characters) makes the report about 120 KB; a pipe holds 64 KB.
		const loud = "console.log('not ok: nope'); for (let i = 0; i < 70; i++) console.log('x'.repeat(2000)); process.exitCode = 3";
		writeFileSync(join(root, "marram.config.mjs"), `export default { gate: { logs: "logs", tiers: { fast: [{ name: "loud", run: ["node", "-e", ${JSON.stringify(loud)}] }] } } };`);
		const result = spawnSync("sh", ["-c", `"${process.execPath}" "${BIN}" gate fast --json | (sleep 1; cat)`], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
		const report = JSON.parse(result.stdout);
		assert.equal(report.failedAt, "loud");
		assert.equal(report.excerpt.split("\n").length, 60);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
