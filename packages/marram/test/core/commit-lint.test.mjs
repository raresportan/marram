// The commit lint: a fix for review findings names each finding's class and rung; nothing else is held to it.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { test } from "node:test";
import { classesIn, problems as against } from "../../src/core/commit-lint.mjs";

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

test("the classes are the project's: its doc's table rows, and its rungs", () => {
	const doc = "| Class | What |\n|---|---|\n| **A**: races | x |\n| **perf**: slow frames | y |\nNot a **row**.\n";
	assert.deepEqual(classesIn(doc), ["A", "perf"]);
	const own = { classes: classesIn(doc), rungs: ["lint", "trace"] };
	assert.deepEqual(against("Fix review findings\n\n- X.\n  Class: perf. Rung: trace (fps)\n", own), []);
	assert.equal(against("Fix review findings\n\n- X.\n  Class: B. Rung: lint\n", own).length, 1);
	assert.equal(against("Fix review findings\n\n- X.\n  Class: A. Rung: check\n", own).length, 1);
});
