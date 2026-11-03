// What starts a lasting resource, as the resource lint's finder sees it. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";
import { acquisitions } from "../../src/node/resource-lint.mjs";

const found = (code) => acquisitions(ts.createSourceFile("x.ts", code, ts.ScriptTarget.Latest, true)).map(({ line, what }) => `${line} ${what}`);

test("a lasting resource is found however it's imported, and wherever it's named", () => {
	assert.deepEqual(found(`import { spawn as run } from "node:child_process";\nrun("ls");`), ["2 starts node:child_process.spawn"]);
	assert.deepEqual(found(`import * as fs from "fs";\nfs.watch(".");`), ["2 starts fs.watch"]);
	assert.deepEqual(found(`import cp from "child_process";\nconst x = promisify(cp.execFile);`), ["2 starts child_process.execFile"]);
	assert.deepEqual(found(`setInterval(tick, 10);`), ["1 starts setInterval"]);
});

test("what finishes before returning, types, members and strings aren't resources", () => {
	assert.deepEqual(found(`import { execFileSync, readFileSync } from "node:child_process";\nexecFileSync("ls");`), []);
	assert.deepEqual(found(`import type { spawn } from "node:child_process";\nlet x: typeof spawn;`), []);
	assert.deepEqual(found(`import { spawn } from "node:child_process";\nconst o = { spawn: 1 }; o.spawn; class A { spawn() {} }`), []);
	assert.deepEqual(found(`const s = "spawn"; // setInterval`), []);
});
