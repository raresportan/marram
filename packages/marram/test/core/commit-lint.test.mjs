// The commit lint: a fix for review findings names each finding's class and rung; nothing else is held to it.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { classesIn, subjectsOf, problems as against } from "../../src/core/commit-lint.mjs";

const BIN = fileURLToPath(new URL("../../bin/marram.mjs", import.meta.url));
const rules = { classes: ["A", "B", "C", "D", "E", "F", "G", "H"] };
const problems = (message) => against(message, rules);

test("each finding of a review fix names its class and rung", () => {
	assert.deepEqual(problems("Fix review findings on #1\n\n- A thing.\n  Class: D. Rung: check (request-cancel)\n- Another.\n  Class: F/C. Rung: journey (activity)\n"), []);
	assert.equal(problems("Fix review findings on #1\n\n- A thing.\n  Class: D. Rung: check\n- Another, unnamed.\n").length, 1);
	assert.deepEqual(problems("Close two review gaps\n\nClass: G. Rung: lint (lint:checks)\n"), []);
	assert.equal(problems("Close two review gaps\n\nThey were small.\n").length, 1);
});

test("a class is one of the doc's, joined by /, or new; a rung is a known kind, or none with a reason", () => {
	assert.deepEqual(problems("Fix review finding\n\n- X.\n  Class: new. Rung: none, because it needs a real account\n"), []);
	for (const line of ["Class: H. Rung: none", "Class: Z. Rung: lint", "Class: A. Rung: vibes", "Rung: lint"]) {
		assert.equal(problems(`Fix review findings\n\n- X.\n  ${line}\n`).length, 1, line);
	}
});

test("other commits, merges and git's comment lines aren't held to it", () => {
	assert.deepEqual(problems("Add a button\n\n- X.\n"), []);
	assert.deepEqual(problems("Merge pull request #9 from x/fix/review-findings\n"), []);
	assert.deepEqual(problems("Fix review findings\n\n- X.\n  Class: B. Rung: type (ContainedPath)\n# Please enter the commit message\n# - a comment bullet\n"), []);
});

test("a fix for review comments, PR feedback or nits is a review fix too, by whatever words", () => {
	for (const subject of ["Address PR feedback", "Fix review comments on the store", "Apply code review suggestions", "Resolve the nits", "Addressed feedback from Sam", "Handle pull request notes", "Applied feedback from Sam", "Applies review", "Applying the nits", "Handling nits", "Handles feedback", "Resolving review", "Resolves all feedback", "Addressing review"]) {
		assert.equal(problems(`${subject}\n\n- X.\n`).length, 1, subject);
	}
	for (const subject of ["Post one sticky PR comment", "Add a review step to CI", "Feedback form layout", "Review the docs"]) {
		assert.deepEqual(problems(`${subject}\n\n- X.\n`), [], subject);
	}
});

test("a project words its review fixes with review.subjects", () => {
	const own = { ...rules, subjects: subjectsOf({ review: { subjects: /^Rework after QA\b/g } }) };
	assert.equal(against("Rework after QA\n\n- X.\n", own).length, 1);
	assert.equal(against("Rework after QA\n\n- X.\n", own).length, 1);
	assert.deepEqual(against("Fix review findings\n\n- X.\n", own), []);
	assert.throws(() => subjectsOf({ review: { subjects: "Rework" } }), /review\.subjects .* is a RegExp/);
});

test("the classes are the project's: its doc's table rows, and its rungs", () => {
	const doc = "| Class | What |\n|---|---|\n| **A**: races | x |\n| **perf**: slow frames | y |\nNot a **row**.\n";
	assert.deepEqual(classesIn(doc), ["A", "perf"]);
	const own = { classes: classesIn(doc), rungs: ["lint", "trace"] };
	assert.deepEqual(against("Fix review findings\n\n- X.\n  Class: perf. Rung: trace (fps)\n", own), []);
	assert.equal(against("Fix review findings\n\n- X.\n  Class: B. Rung: lint\n", own).length, 1);
	assert.equal(against("Fix review findings\n\n- X.\n  Class: A. Rung: check\n", own).length, 1);
});

test("review-summary groups findings since a tag and identifies missing rungs", () => {
	const root = mkdtempSync(join(tmpdir(), "marram-summary-"));
	try {
		const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
		const commit = (message) => git("-c", "user.name=test", "-c", "user.email=test@example.org", "commit", "--allow-empty", "-qm", message);
		const summary = (...args) => execFileSync(process.execPath, [BIN, "review-summary", ...args], { cwd: root, encoding: "utf8" });
		git("init", "-q");
		writeFileSync(join(root, "marram.config.mjs"), "export default {};");
		commit("Fix review findings\n\nClass: ancient. Rung: unit");
		git("tag", "start");
		commit("Fix review gaps\n\n- Lost response\n  Class: race/state. Rung: unit (response test)\n- Missing device\n  Class: race. Rung: none, because hardware is unavailable");
		const hash = git("rev-parse", "HEAD");
		assert.match(summary(), /3 annotated finding/);
		assert.match(summary("--since", "start"), new RegExp(hash.slice(0, 12)));
		git("remote", "add", "origin", "git@github.com:org/project.git");
		const report = summary("--since", "start");
		assert.match(report, /2 annotated findings, 1 without a rung/);
		assert.match(report, /race \(2\)\n  unit \(1\)/);
		assert.match(report, /none \(1\)\n.*because hardware is unavailable/);
		assert.match(report, /state \(1\)/);
		assert.ok(report.includes(`https://github.com/org/project/commit/${hash}`));
		assert.doesNotMatch(report, /ancient/);
		assert.match(summary("--since", "HEAD"), /0 annotated finding/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
