// Disposable checkouts, and paths as git names them. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkoutTree, repoPath } from "../../src/core/checkout.mjs";

/** A repository with one committed file, `sub/a.txt`, and its tree. */
function repository() {
	const root = mkdtempSync(join(tmpdir(), "marram-checkout-"));
	const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	git("init", "-q");
	mkdirSync(join(root, "sub"));
	writeFileSync(join(root, "sub", "a.txt"), "one\ntwo\n");
	git("add", "-A");
	git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
	return { root, tree: git("rev-parse", "HEAD^{tree}"), remove: () => rmSync(root, { recursive: true, force: true }) };
}

test("a path is named from the repository's root, even through another spelling of the folder it's from", () => {
	const repo = repository();
	const elsewhere = mkdtempSync(join(tmpdir(), "marram-alias-"));
	try {
		// A link to the repository: a different path to the same folder, as a Windows short name (RUNNER~1) is.
		const alias = join(elsewhere, "alias");
		symlinkSync(repo.root, alias);
		assert.equal(repoPath(join(alias, "sub"), "a.txt"), "sub/a.txt");
		assert.equal(repoPath(join(alias, "sub")), "sub");
		assert.equal(repoPath(alias), ".");
		assert.equal(repoPath(alias, "../outside.txt"), "../outside.txt");
	} finally {
		repo.remove();
		rmSync(elsewhere, { recursive: true, force: true });
	}
});

test("a checkout has the repository's bytes, whatever core.autocrlf says", () => {
	const repo = repository();
	const scratch = mkdtempSync(join(tmpdir(), "marram-copy-"));
	// As Git for Windows sets it, in a configuration file every repository reads (its system one; a global one here).
	const config = join(scratch, "gitconfig");
	writeFileSync(config, "[core]\n\tautocrlf = true\n");
	const saved = process.env.GIT_CONFIG_GLOBAL;
	process.env.GIT_CONFIG_GLOBAL = config;
	try {
		checkoutTree(repo.root, repo.tree, join(scratch, "copy"));
		assert.equal(readFileSync(join(scratch, "copy", "sub", "a.txt"), "utf8"), "one\ntwo\n");
	} finally {
		if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
		else process.env.GIT_CONFIG_GLOBAL = saved;
		repo.remove();
		rmSync(scratch, { recursive: true, force: true });
	}
});

// Windows runners have the checkout on D: and temporary folders on C:.
test("a path on another drive is outside the repository", { skip: process.platform !== "win32" && "only Windows has drives" }, () => {
	const repo = repository();
	try {
		const other = repo.root.toUpperCase().startsWith("C:") ? "D:\\other.mjs" : "C:\\other.mjs";
		assert.match(repoPath(repo.root, other), /^\.\.\//);
	} finally {
		repo.remove();
	}
});
