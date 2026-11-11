// The pre-push hook against the gate a project asks of a push (`gate.prePush`), reusing what a gate already passed.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const BIN = new URL("../../bin/marram.mjs", import.meta.url).pathname;

/** A repository whose default gate runs stage "d" and full gate "d" then "f", each noting its run in an ignored file. */
function project({ prePush } = {}) {
	const root = mkdtempSync(join(tmpdir(), "marram-hook-"));
	const stage = (name) => ({ name, run: ["node", "-e", `require("fs").appendFileSync("runs", ${JSON.stringify(name)})`] });
	const gate = { logs: "logs", tiers: { fast: [], default: [stage("d")], full: [stage("d"), stage("f")] }, ...(prePush === undefined ? {} : { prePush }) };
	writeFileSync(join(root, "marram.config.mjs"), `export default ${JSON.stringify({ gate })};`);
	writeFileSync(join(root, ".gitignore"), "logs/\nruns\n");
	const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	git("init", "-q");
	const commit = (content) => {
		writeFileSync(join(root, "code.txt"), content);
		git("add", "-A");
		git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", content);
		return git("rev-parse", "HEAD");
	};
	const marram = (args, input = "") => spawnSync("node", [BIN, ...args], { cwd: root, input, encoding: "utf8" });
	return {
		commit,
		runs: () => (existsSync(join(root, "runs")) ? readFileSync(join(root, "runs"), "utf8") : ""),
		push: (sha) => marram(["hook", "pre-push"], `refs/heads/main ${sha} refs/heads/main ${"0".repeat(40)}\n`),
		gate: (...tier) => marram(["gate", ...tier]),
		finish: () => marram(["hook", "finish"]),
		remove: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("a push the project asks the full gate of runs it, once", () => {
	const repo = project({ prePush: "full" });
	try {
		const sha = repo.commit("one");
		const first = repo.push(sha);
		assert.equal(first.status, 0, first.stderr);
		assert.equal(repo.runs(), "df");
		assert.equal(repo.push(sha).status, 0);
		assert.equal(repo.runs(), "df", "the full pass is reused");
	} finally {
		repo.remove();
	}
});

test("a default pass doesn't do for a push that needs the full gate", () => {
	const repo = project({ prePush: "full" });
	try {
		const sha = repo.commit("one");
		assert.equal(repo.gate().status, 0);
		assert.equal(repo.runs(), "d");
		assert.equal(repo.push(sha).status, 0);
		assert.equal(repo.runs(), "ddf");
	} finally {
		repo.remove();
	}
});

test("a full pass counts for the default gate, and a default run after it doesn't replace it", () => {
	const repo = project({ prePush: "full" });
	try {
		const sha = repo.commit("one");
		assert.equal(repo.gate("full").status, 0);
		assert.equal(repo.finish().status, 0);
		assert.equal(repo.runs(), "df", "finish reuses the full pass");
		assert.equal(repo.gate().status, 0);
		assert.equal(repo.push(sha).status, 0);
		assert.equal(repo.runs(), "dfd", "the push still finds the full pass");
	} finally {
		repo.remove();
	}
});

test("without gate.prePush, a push needs the default gate", () => {
	const repo = project();
	try {
		const sha = repo.commit("one");
		assert.equal(repo.push(sha).status, 0);
		assert.equal(repo.runs(), "d");
	} finally {
		repo.remove();
	}
});

test("gate.prePush names a gate a push can require", () => {
	const repo = project({ prePush: "fast" });
	try {
		const refused = repo.push(repo.commit("one"));
		assert.equal(refused.status, 1);
		assert.match(refused.stderr, /a push can require the default gate or the full one/);
	} finally {
		repo.remove();
	}
});
