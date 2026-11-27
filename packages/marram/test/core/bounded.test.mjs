// A command run for at most a given time: stopped at it, even one that ignores SIGTERM and leaves a process holding its
// output. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runBounded } from "../../src/core/bounded.mjs";

test("a command that finishes in time reports how it ended, with its output", () => {
	const result = runBounded(process.execPath, ["-e", 'console.log("out"); console.error("err"); process.exit(3)'], { timeout: 10_000, capture: true });
	assert.equal(result.status, 3);
	assert.equal(result.error, undefined);
	assert.equal(result.stdout.trim(), "out");
	assert.equal(result.stderr.trim(), "err");
	assert.equal(runBounded("no-such-command-anywhere", [], { timeout: 10_000 }).error.code, "ENOENT");
});

test("a command that ignores SIGTERM, with a child that does too and holds its output, is killed after the grace period", { skip: process.platform === "win32" && "taskkill ends the tree at once" }, () => {
	// The child outlives its parent's SIGKILL unless the whole group is killed, and keeps stdout open meanwhile.
	const child = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);';
	const parent = `process.on("SIGTERM", () => {}); require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(child)}], { stdio: "inherit" }); setInterval(() => {}, 1000);`;
	const started = Date.now();
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import { runBounded } from ${JSON.stringify(new URL("../../src/core/bounded.mjs", import.meta.url).href)};\nconst r = runBounded(process.execPath, ["-e", ${JSON.stringify(parent)}], { timeout: 500, capture: true });\nconsole.log(JSON.stringify({ code: r.error?.code }));`], { encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL" });
	assert.notEqual(result.error?.code, "ETIMEDOUT", "runBounded hung");
	assert.deepEqual(JSON.parse(result.stdout), { code: "ETIMEDOUT" });
	assert.ok(Date.now() - started < 15_000, `took ${Date.now() - started} ms`);
});

const BOUNDED = new URL("../../src/core/bounded.mjs", import.meta.url).href;
const POSIX = { skip: process.platform === "win32" && "reads ps and signals a process group" };

test("the command's env isn't on the supervisor's command line", POSIX, () => {
	// The command reads its parent's (the supervisor's) command line, as ps shows it to anyone on the machine.
	const shown = 'console.log(require("node:child_process").execFileSync("ps", ["-o", "args=", "-p", String(process.ppid)], { encoding: "utf8" }))';
	const result = runBounded(process.execPath, ["-e", shown], { timeout: 10_000, capture: true, env: { ...process.env, TOKEN: "synthetic-secret-value" } });
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /--supervise/);
	assert.doesNotMatch(result.stdout, /synthetic-secret-value/);
});

test("an interrupted supervisor kills what the command left running, so its caller returns", POSIX, async () => {
	const folder = mkdtempSync(join(tmpdir(), "marram-bounded-"));
	try {
		// The command notes the supervisor's pid, then starts a child that ignores SIGTERM and holds its stdout; it doesn't.
		const marker = join(folder, "supervisor");
		const child = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);';
		const command = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(process.ppid)); require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(child)}], { stdio: "inherit" }); setInterval(() => {}, 1000);`;
		const caller = spawn(process.execPath, ["--input-type=module", "-e", `import { runBounded } from ${JSON.stringify(BOUNDED)};\nrunBounded(process.execPath, ["-e", ${JSON.stringify(command)}], { timeout: 60_000, capture: true });`], { stdio: "ignore" });
		const exited = new Promise((done) => caller.on("exit", done));
		const until = Date.now() + 15_000;
		while (!existsSync(marker) || readFileSync(marker, "utf8") === "") {
			assert.ok(Date.now() < until, "the command never started");
			await new Promise((done) => setTimeout(done, 50));
		}
		const started = Date.now();
		process.kill(Number(readFileSync(marker, "utf8")), "SIGTERM");
		const deadline = new Promise((done) => setTimeout(() => done("hung"), 20_000).unref());
		const outcome = await Promise.race([exited.then(() => "returned"), deadline]);
		if (outcome === "hung") caller.kill("SIGKILL");
		assert.equal(outcome, "returned", "the caller waited on the left-over child");
		assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started} ms`);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});
