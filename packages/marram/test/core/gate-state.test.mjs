// The working tree's hash, which the gate's verdicts are keyed by. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { treeOf } from "../../src/core/gate-state.mjs";

test("a same-size edit in the second its file was staged changes the tree, at any fraction of that second", () => {
	// 2026-01-01T00:00:00Z, and the same second's last hundred microseconds, which rounds up to the next millisecond.
	for (const second of [1767225600, 1767225600.9999]) {
		const root = mkdtempSync(join(tmpdir(), "marram-tree-"));
		try {
			const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
			git("init", "-q");
			// Without ctime, git judges a file by its size and mtime: the case where only the index's own time tells git
			// to look at the content.
			git("config", "core.trustctime", "false");
			const file = join(root, "stage.js");
			writeFileSync(file, "process.exit(1)");
			utimesSync(file, second, second);
			git("add", "-A");
			const staged = git("write-tree");
			utimesSync(join(root, ".git", "index"), second, second);
			writeFileSync(file, "process.exit(0)");
			utimesSync(file, second, second);
			assert.notEqual(treeOf(root), staged, `at ${second}`);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
});
