import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("replay distinguishes a regression from unchanged behavior and unrelated failures", () => {
	const root = mkdtempSync(join(tmpdir(), "replay-test-"));
	const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	const commit = () => {
		git("add", ".");
		git("-c", "user.name=test", "-c", "user.email=test@example.org", "commit", "-qm", "snapshot");
		return git("rev-parse", "HEAD");
	};
	const { NODE_TEST_CONTEXT, ...env } = process.env;
	const replay = (base, message) => spawnSync(process.execPath, [fileURLToPath(new URL("../../bin/marram.mjs", import.meta.url)),
		"replay", base, "probe.cjs", "reads one", message], { cwd: root, env, encoding: "utf8" });
	try {
		git("init", "-q");
		writeFileSync(join(root, "marram.config.mjs"), "export default {}");
		writeFileSync(join(root, "value.cjs"), "module.exports = 0");
		const base = commit();
		writeFileSync(join(root, "value.cjs"), "module.exports = 1");
		writeFileSync(join(root, "probe.cjs"), 'require("node:test")("reads one", () => require("node:assert/strict").equal(require("./value.cjs"), 1, "stored value"));');
		commit();
		const redGreen = replay(base, "stored value");
		assert.equal(redGreen.status, 0, redGreen.stdout + redGreen.stderr);
		assert.match(JSON.parse(redGreen.stdout).base.detail, /0 !== 1/);
		assert.equal(replay("HEAD", "stored value").status, 1);
		assert.equal(JSON.parse(replay(base, "different assertion").stdout).base.state, "inconclusive");
		assert.equal(git("worktree", "list").split("\n").length, 1, "replay adds no worktrees to the caller's repository");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

/** A repository whose base and candidate commits are made by `make`, and a replay of `test` in `file` against them. */
function repository(make) {
	const root = mkdtempSync(join(tmpdir(), "replay-test-"));
	const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	const commit = () => {
		git("add", "-A");
		git("-c", "user.name=test", "-c", "user.email=test@example.org", "commit", "-qm", "snapshot");
		return git("rev-parse", "HEAD");
	};
	git("init", "-q");
	const { NODE_TEST_CONTEXT, ...env } = process.env;
	const replay = (base, file, name = "reads one") => spawnSync(process.execPath, [fileURLToPath(new URL("../../bin/marram.mjs", import.meta.url)),
		"replay", base, file, name, "stored value"], { cwd: root, env, encoding: "utf8" });
	return { root, git, commit, replay, remove: () => rmSync(root, { recursive: true, force: true }) };
}

const PROBE = 'require("node:test")("reads one", () => require("node:assert/strict").equal(require("./value.cjs"), 1, "stored value"));';

test("replay's setup runs in a repository of its own, not the caller's", () => {
	const repo = repository();
	try {
		writeFileSync(join(repo.root, "marram.config.mjs"), 'export default { replay: { setup: ["git", "branch", "made-by-setup"] } }');
		writeFileSync(join(repo.root, "value.cjs"), "module.exports = 0");
		const base = repo.commit();
		writeFileSync(join(repo.root, "value.cjs"), "module.exports = 1");
		writeFileSync(join(repo.root, "probe.cjs"), PROBE);
		repo.commit();
		const result = repo.replay(base, "probe.cjs");
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.equal(repo.git("branch", "--list", "made-by-setup"), "");
		assert.equal(repo.git("worktree", "list").split("\n").length, 1);
	} finally {
		repo.remove();
	}
});

test("replay won't write the test through a directory that points outside its checkout", () => {
	const repo = repository();
	const outside = mkdtempSync(join(tmpdir(), "replay-outside-"));
	try {
		writeFileSync(join(repo.root, "marram.config.mjs"), "export default {}");
		symlinkSync(outside, join(repo.root, "tests"));
		const base = repo.commit();
		rmSync(join(repo.root, "tests"));
		mkdirSync(join(repo.root, "tests"));
		writeFileSync(join(repo.root, "tests/value.cjs"), "module.exports = 1");
		writeFileSync(join(repo.root, "tests/probe.cjs"), PROBE);
		repo.commit();
		const result = repo.replay(base, "tests/probe.cjs");
		assert.equal(result.status, 1);
		const { base: before, candidate } = JSON.parse(result.stdout);
		assert.deepEqual(before, { revision: base, state: "inconclusive", detail: "Test directory points outside checkout" });
		assert.equal(candidate.state, "passed");
		assert.deepEqual(readdirSync(outside), []);
	} finally {
		repo.remove();
		rmSync(outside, { recursive: true, force: true });
	}
});

test("replay names a test inside a suite, and says so when given the suite", () => {
	const repo = repository();
	try {
		writeFileSync(join(repo.root, "marram.config.mjs"), "export default {}");
		writeFileSync(join(repo.root, "value.cjs"), "module.exports = 0");
		const base = repo.commit();
		writeFileSync(join(repo.root, "value.cjs"), "module.exports = 1");
		writeFileSync(join(repo.root, "probe.cjs"), [
			'const { describe, it } = require("node:test");',
			'describe("counter", () => it("reads one", () => require("node:assert/strict").equal(require("./value.cjs"), 1, "stored value")));',
		].join("\n"));
		repo.commit();
		const inner = repo.replay(base, "probe.cjs");
		assert.equal(inner.status, 0, inner.stdout + inner.stderr);
		const suite = repo.replay(base, "probe.cjs", "counter");
		assert.equal(suite.status, 1);
		assert.equal(JSON.parse(suite.stdout).base.detail, '"counter" is a suite: name the test inside it that makes the assertion');
	} finally {
		repo.remove();
	}
});

test("replay refuses a setup that isn't a command and its arguments", () => {
	const repo = repository();
	try {
		writeFileSync(join(repo.root, "marram.config.mjs"), 'export default { replay: { setup: "npm ci" } }');
		writeFileSync(join(repo.root, "probe.cjs"), PROBE);
		const base = repo.commit();
		const result = repo.replay(base, "probe.cjs");
		assert.equal(result.status, 1);
		assert.equal(result.stdout, "");
		assert.match(result.stderr, /replay\.setup in marram\.config\.mjs must be a command and its arguments/);
	} finally {
		repo.remove();
	}
});

/** Code that waits a minute, writing `file` after a second and a half if it's still running then. */
const lingers = (file) => `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(file)}, "still running"), 1500); setTimeout(() => {}, 60000);`;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

test("a setup that doesn't finish in replay.timeoutMs is stopped, and the side is inconclusive", () => {
	const repo = repository();
	const outside = mkdtempSync(join(tmpdir(), "replay-outside-"));
	try {
		const setup = ["node", "-e", lingers(join(outside, "setup"))];
		writeFileSync(join(repo.root, "marram.config.mjs"), `export default { replay: { setup: ${JSON.stringify(setup)}, timeoutMs: 500 } }`);
		writeFileSync(join(repo.root, "value.cjs"), "module.exports = 0");
		const base = repo.commit();
		writeFileSync(join(repo.root, "value.cjs"), "module.exports = 1");
		writeFileSync(join(repo.root, "probe.cjs"), PROBE);
		repo.commit();
		const started = Date.now();
		const result = repo.replay(base, "probe.cjs");
		assert.ok(Date.now() - started < 20_000, "replay waited for the setup");
		assert.equal(result.status, 1);
		const { base: before, candidate } = JSON.parse(result.stdout);
		assert.equal(before.detail, "Setup didn't finish within 500 ms");
		assert.equal(candidate.detail, "Setup didn't finish within 500 ms");
		pause(2000);
		assert.equal(existsSync(join(outside, "setup")), false, "the setup was left running");
	} finally {
		repo.remove();
		rmSync(outside, { recursive: true, force: true });
	}
});

test("a test that doesn't finish in replay.timeoutMs is stopped, with what it started, and the side is inconclusive", () => {
	const repo = repository();
	const outside = mkdtempSync(join(tmpdir(), "replay-outside-"));
	try {
		writeFileSync(join(repo.root, "marram.config.mjs"), "export default { replay: { timeoutMs: 500 } }");
		writeFileSync(join(repo.root, "value.cjs"), "module.exports = 0");
		const base = repo.commit();
		writeFileSync(join(repo.root, "probe.cjs"), `require("node:test")("reads one", () => new Promise(() => { ${lingers(join(outside, "test"))} }));`);
		repo.commit();
		const started = Date.now();
		const result = repo.replay(base, "probe.cjs");
		assert.ok(Date.now() - started < 20_000, "replay waited for the test");
		assert.equal(result.status, 1);
		const { base: before, candidate } = JSON.parse(result.stdout);
		assert.equal(before.detail, "The test didn't finish within 500 ms");
		assert.equal(candidate.detail, "The test didn't finish within 500 ms");
		pause(2000);
		assert.equal(existsSync(join(outside, "test")), false, "the test was left running");
	} finally {
		repo.remove();
		rmSync(outside, { recursive: true, force: true });
	}
});

test("replay refuses a timeout that isn't a positive number of milliseconds", () => {
	const repo = repository();
	try {
		writeFileSync(join(repo.root, "marram.config.mjs"), 'export default { replay: { timeoutMs: "5m" } }');
		writeFileSync(join(repo.root, "probe.cjs"), PROBE);
		const base = repo.commit();
		const result = repo.replay(base, "probe.cjs");
		assert.equal(result.status, 1);
		assert.match(result.stderr, /replay\.timeoutMs in marram\.config\.mjs must be a positive number of milliseconds/);
	} finally {
		repo.remove();
	}
});
