// A command run for at most a given time: stopped at it, even one that ignores SIGTERM and leaves a process holding its
// output. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
