// The working tree's hash, which the gate's verdicts are keyed by. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { copyIndex, treeOf } from "../../src/core/gate-state.mjs";

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

// Windows won't rename over a file that's open, so git can't replace the index while it's being copied there.
test("an index replaced while it's copied doesn't lend the copy its newer time", { skip: process.platform === "win32" && "the race can't happen on Windows" }, () => {
	const dir = mkdtempSync(join(tmpdir(), "marram-index-"));
	try {
		const [real, copy] = [join(dir, "index"), join(dir, "copy")];
		writeFileSync(real, "old entries");
		utimesSync(real, 1767225600, 1767225600);
		// What a concurrent `git add` does: write a new index beside it, then rename it over the old one.
		const replace = () => {
			writeFileSync(join(dir, "index.lock"), "new entries");
			utimesSync(join(dir, "index.lock"), 1767225610, 1767225610);
			renameSync(join(dir, "index.lock"), real);
		};
		copyIndex(real, copy, replace);
		assert.equal(readFileSync(copy, "utf8"), "old entries");
		assert.equal(statSync(copy).mtimeMs, 1767225600_000, "the copy has the time of the index it copied");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
