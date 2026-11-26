// Probes: a known defect put back by a patch must still be caught by its check. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const BIN = new URL("../../bin/marram.mjs", import.meta.url).pathname;
const CHECK = 'require("node:assert/strict").equal(require("./value.cjs"), 1, "stored value");\n';
const NODE_TEST = 'require("node:test")("reads one", () => require("node:assert/strict").equal(require("./value.cjs"), 1, "stored value"));\n';

/**
 * A committed project with a stored value, a check of it, and a patch that sets the value to 0: the known defect. Its
 * probes are `faults`, written into marram.config.mjs as source so a RegExp stays one.
 */
function project(faults, options = "") {
	const root = mkdtempSync(join(tmpdir(), "marram-probe-"));
	const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	const write = (path, content) => {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), content);
	};
	git("init", "-q");
	write("value.cjs", "module.exports = 1;\n");
	write("check.cjs", CHECK);
	write("value.test.cjs", NODE_TEST);
	write(".gitignore", "shared/\nready\nnode_modules/\n");
	git("add", "-A");
	git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "project");
	write("value.cjs", "module.exports = 0;\n");
	write("probes/zero.patch", `${git("diff")}\n`);
	write("value.cjs", "module.exports = 1;\n");
	write("marram.config.mjs", `export default { probes: { ${options} faults: [${faults}] } };\n`);
	git("add", "-A");
	git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "probes");
	const { NODE_TEST_CONTEXT, ...env } = process.env;
	return {
		root,
		write,
		probe: (...names) => spawnSync(process.execPath, [BIN, "probe", ...names], { cwd: root, env, encoding: "utf8" }),
		remove: () => rmSync(root, { recursive: true, force: true }),
	};
}

const BY_COMMAND = '{ name: "a stored zero", patch: "probes/zero.patch", run: ["node", "check.cjs"], expect: /stored value/ }';
const BY_TEST = '{ name: "a stored zero, by test", patch: "probes/zero.patch", test: { file: "value.test.cjs", name: "reads one", assertion: "stored value" } }';

test("a fault its check fails on, for the reason given, is caught, and the copy it ran in is gone", () => {
	const repo = project(`${BY_COMMAND}, ${BY_TEST}`);
	try {
		const before = readdirSync(tmpdir()).filter((name) => name.startsWith("marram-probe-copy-")).length;
		const result = repo.probe();
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /^✓ a stored zero: caught \(\d+ ms\)$/m);
		assert.match(result.stdout, /^✓ a stored zero, by test: caught \(\d+ ms\)$/m);
		assert.match(result.stdout, /^2\/2 faults caught$/m);
		assert.equal(readdirSync(tmpdir()).filter((name) => name.startsWith("marram-probe-copy-")).length, before);
	} finally {
		repo.remove();
	}
});

test("a check weakened in the working tree misses the fault, and says so", () => {
	const repo = project(`${BY_COMMAND}, ${BY_TEST}`);
	try {
		repo.write("check.cjs", "// The value is checked elsewhere.\n");
		repo.write("value.test.cjs", 'require("node:test")("reads one", () => {});\n');
		const result = repo.probe();
		assert.equal(result.status, 1);
		assert.match(result.stdout, /^✗ a stored zero: missed: the check passed with the fault in place$/m);
		assert.match(result.stdout, /^✗ a stored zero, by test: missed: the check passed with the fault in place$/m);
		assert.match(result.stdout, /^0\/2 faults caught\. Missed: a stored zero, a stored zero, by test$/m);
	} finally {
		repo.remove();
	}
});

test("a check that fails for another reason, a clean run that fails, or a patch that no longer applies is inconclusive", () => {
	const cases = {
		"failed, but not as expected": (repo) => {
			repo.write("check.cjs", CHECK.replace("stored value", "another check"));
			repo.write("value.test.cjs", NODE_TEST.replace("stored value", "another check"));
		},
		"the check fails without the fault": (repo) => {
			repo.write("check.cjs", `require("./missing.cjs");\n${CHECK}`);
			repo.write("value.test.cjs", NODE_TEST.replace("1, ", "2, "));
		},
		"the patch no longer applies": (repo) => repo.write("value.cjs", "module.exports = 1; // stored\n"),
	};
	for (const [reason, change] of Object.entries(cases)) {
		const repo = project(`${BY_COMMAND}, ${BY_TEST}`);
		try {
			change(repo);
			const result = repo.probe();
			assert.equal(result.status, 1, reason);
			assert.match(result.stdout, new RegExp(`^\\? a stored zero: inconclusive: ${reason}`, "m"), result.stdout);
			assert.match(result.stdout, new RegExp(`^\\? a stored zero, by test: inconclusive: ${reason}`, "m"), result.stdout);
		} finally {
			repo.remove();
		}
	}
});

test("setup runs once in the copy, linked paths are shared from the working tree, and a patch can't reach through a link", () => {
	const needs = 'require("node:fs").statSync("ready");\nrequire("./shared/flag.cjs");\n';
	const throughLink = '{ name: "through the link", patch: "probes/link.patch", run: ["node", "check.cjs"], expect: /stored value/ }';
	const repo = project(`${BY_COMMAND}, ${throughLink}`, 'setup: ["node", "-e", "require(\\"node:fs\\").writeFileSync(\\"ready\\", \\"\\")"], link: ["shared"],');
	try {
		repo.write("check.cjs", needs + CHECK);
		repo.write("shared/flag.cjs", "module.exports = true;\n");
		repo.write("probes/link.patch", ["diff --git a/shared/flag.cjs b/shared/flag.cjs", "--- a/shared/flag.cjs", "+++ b/shared/flag.cjs", "@@ -1 +1 @@", "-module.exports = true;", "+module.exports = false;", ""].join("\n"));
		const result = repo.probe();
		assert.match(result.stdout, /^✓ a stored zero: caught/m, result.stdout + result.stderr);
		assert.match(result.stdout, /^\? through the link: inconclusive: the patch no longer applies/m);
		assert.equal(existsSync(join(repo.root, "ready")), false, "setup ran in the copy");
	} finally {
		repo.remove();
	}
});

test("named faults run on their own, and an unknown name or a malformed fault is refused", () => {
	const repo = project(`${BY_COMMAND}, ${BY_TEST}`);
	try {
		const one = repo.probe("a stored zero, by test");
		assert.equal(one.status, 0, one.stderr);
		assert.match(one.stdout, /^1\/1 faults caught$/m);
		assert.doesNotMatch(one.stdout, /^✓ a stored zero:/m);
		const unknown = repo.probe("no such fault");
		assert.equal(unknown.status, 1);
		assert.match(unknown.stderr, /No fault named "no such fault"/);
		repo.write("marram.config.mjs", 'export default { probes: { faults: [{ name: "half", patch: "probes/zero.patch" }] } };\n');
		const malformed = repo.probe();
		assert.equal(malformed.status, 1);
		assert.match(malformed.stderr, /probes\.faults\[0\] \("half"\) needs either run and expect, or test: \{ file, name, assertion \}/);
	} finally {
		repo.remove();
	}
});

test("a fault leaves the copy as it found it, file times included, for the next fault", () => {
	// A check that refuses a build older than its source, as a build tool's staleness check would.
	const fresh = 'const { statSync } = require("node:fs");\nif (statSync("value.cjs").mtimeMs > statSync("ready").mtimeMs) throw new Error("stale build");\n';
	const second = BY_COMMAND.replace('"a stored zero"', '"a stored zero, again"');
	const repo = project(`${BY_COMMAND}, ${second}`, 'setup: ["node", "-e", "require(\\"node:fs\\").writeFileSync(\\"ready\\", \\"\\")"],');
	try {
		repo.write("check.cjs", CHECK + fresh);
		const result = repo.probe();
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /^✓ a stored zero, again: caught/m);
	} finally {
		repo.remove();
	}
});

/** A patch setting `path`'s one line from `from` to `to`. */
const patchOf = (path, from, to) => [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, "@@ -1 +1 @@", `-${from}`, `+${to}`, ""].join("\n");

test("a linked folder's links into the repository lead into the copy, so a patched workspace package is the one checked", () => {
	const faults = [
		'{ name: "a relative link", patch: "probes/lib.patch", run: ["node", "check-lib.cjs"], expect: /lib value/ }',
		'{ name: "an absolute link", patch: "probes/lib.patch", run: ["node", "check-scoped.cjs"], expect: /scoped value/ }',
	];
	const repo = project(faults.join(", "), 'link: ["node_modules"],');
	try {
		repo.write("packages/lib/index.cjs", "module.exports = 1;\n");
		repo.write("probes/lib.patch", patchOf("packages/lib/index.cjs", "module.exports = 1;", "module.exports = 0;"));
		repo.write("check-lib.cjs", 'require("dep");\nrequire("node:assert/strict").equal(require("lib"), 1, "lib value");\n');
		repo.write("check-scoped.cjs", 'require("node:assert/strict").equal(require("@scope/lib"), 1, "scoped value");\n');
		repo.write("node_modules/dep/index.cjs", "module.exports = true;\n");
		repo.write("node_modules/dep/package.json", JSON.stringify({ main: "index.cjs" }));
		repo.write("packages/lib/package.json", JSON.stringify({ main: "index.cjs" }));
		symlinkSync("../packages/lib", join(repo.root, "node_modules/lib"));
		mkdirSync(join(repo.root, "node_modules/@scope"));
		symlinkSync(join(repo.root, "packages/lib"), join(repo.root, "node_modules/@scope/lib"));
		const result = repo.probe();
		assert.match(result.stdout, /^✓ a relative link: caught/m, result.stdout + result.stderr);
		assert.match(result.stdout, /^✓ an absolute link: caught/m);
		assert.equal(readFileSync(join(repo.root, "packages/lib/index.cjs"), "utf8"), "module.exports = 1;\n", "the working tree's package is untouched");
	} finally {
		repo.remove();
	}
});

test("a link to a path the working tree doesn't have, or over one it does, is refused, as are a bad timeout and cwd", () => {
	const refusals = [
		['link: ["missing"],', BY_COMMAND, /probes\.link: missing isn't in the working tree/],
		['link: ["dangling"],', BY_COMMAND, /probes\.link: dangling is in the working tree, and only an ignored path can be linked/],
		["timeoutMs: -1,", BY_COMMAND, /probes\.timeoutMs must be a positive number of milliseconds/],
		["", BY_COMMAND.replace("patch:", "cwd: 5, patch:"), /probes\.faults\[0\] \("a stored zero"\): cwd must be a path in the project/],
	];
	for (const [options, fault, refusal] of refusals) {
		const repo = project(fault, options);
		try {
			symlinkSync("nowhere", join(repo.root, "dangling"));
			const result = repo.probe();
			assert.equal(result.status, 1, options);
			assert.match(result.stderr, refusal);
		} finally {
			repo.remove();
		}
	}
});

test("a patch that renames a file puts it back with its times", () => {
	const fresh = 'const { statSync } = require("node:fs");\nif (statSync("source.txt").mtimeMs > statSync("ready").mtimeMs) throw new Error("stale build");\n';
	const moved = '{ name: "a moved source", patch: "probes/move.patch", run: ["node", "check.cjs"], expect: /stored value/ }';
	const repo = project(`${moved}, ${BY_COMMAND}`, 'setup: ["node", "-e", "require(\\"node:fs\\").writeFileSync(\\"ready\\", \\"\\")"],');
	try {
		repo.write("source.txt", "source\n");
		repo.write("check.cjs", CHECK + fresh);
		const move = ["diff --git a/source.txt b/moved.txt", "similarity index 100%", "rename from source.txt", "rename to moved.txt", patchOf("value.cjs", "module.exports = 1;", "module.exports = 0;")].join("\n");
		repo.write("probes/move.patch", move);
		const result = repo.probe();
		assert.match(result.stdout, /^✓ a moved source: caught/m, result.stdout + result.stderr);
		assert.match(result.stdout, /^✓ a stored zero: caught/m);
	} finally {
		repo.remove();
	}
});
