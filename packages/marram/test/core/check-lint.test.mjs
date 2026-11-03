// The check lint: a check can fail on what it sees, and waits only through `until`.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";
import { checkProblems } from "../../src/core/check-lint.mjs";

const lint = (code, waits) => checkProblems(ts.createSourceFile("x-check.ts", code, ts.ScriptTarget.Latest, true), waits);

test("a check that can't fail is flagged; an assert, a throw, an until or a non-zero exit can fail", () => {
	assert.equal(lint(`console.log("saw", 1);`).length, 1);
	assert.equal(lint(`process.exit(0);`).length, 1);
	for (const code of [
		`import assert from "node:assert/strict"; assert.equal(1, 1);`,
		`import * as a from "assert"; a.ok(true);`,
		`throw new Error("no");`,
		`process.exit(1);`,
		`process.exitCode = 2;`,
		`import { until } from "@raresportan/marram/core/until"; await until(() => true, "x");`,
	]) assert.deepEqual(lint(code), [], code);
});

test("the waits module is the project's", () => {
	assert.equal(lint(`import { until } from "./until.ts"; await until(() => true, "x");`).length, 1);
	assert.deepEqual(lint(`import { until } from "./until.ts"; await until(() => true, "x");`, "./until.ts"), []);
});

test("a loop that sleeps until something holds is a wait of its own", () => {
	const problems = lint(`throw 0; while (!done) await sleep(10);`);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /^line 1: a loop that sleeps .* until\(\) from @raresportan\/marram\/core\/until/);
	assert.equal(lint(`throw 0; for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 5)); }`).length, 1);
	assert.deepEqual(lint(`throw 0; for (const step of steps) await delay(5);`), []);
	assert.deepEqual(lint(`throw 0;\n// Not a wait: a retry, three times.\nfor (let i = 0; i < 3; i++) await sleep(5);`), []);
	assert.deepEqual(lint(`throw 0; while (queue.length > 0) await queue.shift()();`), []);
});

test("an upper bound on elapsed time is flagged, however it's written", () => {
	assert.equal(lint(`throw 0; if (Date.now() - started < 900) {}`).length, 1);
	assert.equal(lint(`throw 0; const took = performance.now() - t; if (1000 > took) {}`).length, 1);
	assert.equal(lint(`throw 0; const took = Date.now() - t; const ms = took; if (ms <= 5) {}`).length, 1);
	assert.deepEqual(lint(`throw 0; if (Date.now() - started > 900) {}`), []);
});
