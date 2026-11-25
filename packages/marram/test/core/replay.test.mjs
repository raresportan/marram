import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
