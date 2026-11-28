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

test("a command that exits leaving a process that holds its output still has its timeout: what it left is stopped, and it timed out", POSIX, () => {
	// The wrapper exits at once; what it started keeps stdout open for two seconds, past the timeout.
	const wrapper = 'require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 2000)"], { stdio: "inherit" }).unref();';
	const started = Date.now();
	const result = runBounded(process.execPath, ["-e", wrapper], { timeout: 600, capture: true });
	assert.equal(result.error?.code, "ETIMEDOUT", JSON.stringify(result));
	assert.ok(Date.now() - started < 1_800, `took ${Date.now() - started} ms`);
	// One that leaves nothing behind still reports at once.
	const quick = Date.now();
	assert.equal(runBounded(process.execPath, ["-e", "process.exit(0)"], { timeout: 10_000 }).status, 0);
	assert.ok(Date.now() - quick < 3_000);
});

test("a process the command starts in a group of its own, holding its output, doesn't hold the caller past the timeout", () => {
	// Detached, so it's in no group the supervisor can signal; it keeps stdout open for two seconds.
	const wrapper = 'require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 2000)"], { stdio: "inherit", detached: true }).unref();';
	const started = Date.now();
	const result = runBounded(process.execPath, ["-e", wrapper], { timeout: 500, capture: true });
	assert.equal(result.error?.code, "ETIMEDOUT", JSON.stringify(result));
	assert.ok(Date.now() - started < 1_800, `took ${Date.now() - started} ms`);
});

test("a command whose output goes to a terminal is told to colour it, unless the project says otherwise or its output is captured", () => {
	const folder = mkdtempSync(join(tmpdir(), "marram-colour-"));
	try {
		const seen = join(folder, "seen.json");
		const record = `require("node:fs").writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ force: process.env.FORCE_COLOR ?? null, none: process.env.NO_COLOR ?? null }))`;
		const plain = { ...process.env };
		delete plain.FORCE_COLOR;
		delete plain.NO_COLOR;
		const colourSeen = (options) => {
			assert.equal(runBounded(process.execPath, ["-e", record], { timeout: 10_000, env: plain, ...options }).status, 0);
			return JSON.parse(readFileSync(seen, "utf8"));
		};
		assert.deepEqual(colourSeen({ terminal: true }), { force: "1", none: null });
		assert.deepEqual(colourSeen({ terminal: false }), { force: null, none: null });
		assert.deepEqual(colourSeen({ terminal: true, capture: true }), { force: null, none: null });
		assert.deepEqual(colourSeen({ terminal: true, env: { ...plain, NO_COLOR: "1" } }), { force: null, none: "1" });
		assert.deepEqual(colourSeen({ terminal: true, env: { ...plain, FORCE_COLOR: "0" } }), { force: "0", none: null });
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

/** A process that runs `command` under runBounded with `timeout`, and prints what it returned as JSON. */
const caller = (command, timeout) => spawn(process.execPath, ["--input-type=module", "-e", `
	import { runBounded } from ${JSON.stringify(BOUNDED)};
	const r = runBounded(process.execPath, ["-e", ${JSON.stringify(command)}], { timeout: ${timeout}, capture: true });
	console.log(JSON.stringify({ status: r.status, signal: r.signal, code: r.error?.code ?? null }));
`], { stdio: ["ignore", "pipe", "inherit"] });

const outcome = (child) => new Promise((resolve) => {
	let out = "";
	child.stdout.on("data", (chunk) => { out += chunk; });
	child.on("exit", () => resolve(JSON.parse(out)));
});

const waitFor = async (path) => {
	for (const until = Date.now() + 20_000; !existsSync(path); ) {
		if (Date.now() > until) assert.fail(`${path} never appeared`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
};

test("an interrupted command is reported interrupted, though it cleans up and exits 0 after its deadline", POSIX, async () => {
	const root = mkdtempSync(join(tmpdir(), "marram-bounded-"));
	try {
		// Writes its supervisor's pid, then on SIGTERM takes 600 ms to clean up, past the 350 ms deadline, and exits 0.
		const supervisor = join(root, "supervisor");
		const command = `require("node:fs").writeFileSync(${JSON.stringify(supervisor)}, String(process.ppid)); process.on("SIGTERM", () => setTimeout(() => process.exit(0), 600)); setInterval(() => {}, 1000);`;
		const result = outcome(caller(command, 350));
		await waitFor(supervisor);
		process.kill(Number(readFileSync(supervisor, "utf8")), "SIGTERM");
		assert.deepEqual(await result, { status: 0, signal: null, code: "EINTR" });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
