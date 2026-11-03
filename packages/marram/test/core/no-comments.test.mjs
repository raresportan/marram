// The no-comments rule: doc comments, license headers and links stay; the rest goes. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";
import { comments } from "../../src/core/no-comments.mjs";

const found = (code) => comments(ts.createSourceFile("x.ts", code, ts.ScriptTarget.Latest, true)).map(({ line }) => line);

test("a plain comment is flagged, once, wherever it is", () => {
	assert.deepEqual(found(`// why\nconst a = 1;`), [1]);
	assert.deepEqual(found(`const a = 1; // why`), [1]);
	assert.deepEqual(found(`const a = 1;\n/* why */\nconst b = 2;`), [2]);
	assert.deepEqual(found(`function f() {\n\t// why\n\treturn 1;\n}`), [2]);
	assert.deepEqual(found(`const a = 1;\n// the end\n`), [2]);
});

test("doc comments, license headers and links aren't", () => {
	assert.deepEqual(found(`/** What it is. */\nexport const a = 1;`), []);
	assert.deepEqual(found(`// Copyright 2026 Someone\nconst a = 1;`), []);
	assert.deepEqual(found(`// SPDX-License-Identifier: MIT\nconst a = 1;`), []);
	assert.deepEqual(found(`// See https://example.com/bug/1\nconst a = 1;`), []);
	assert.deepEqual(found(`const a = 1;\n// Copyright is not a license here\nconst b = 2;`), [2]);
});

test("text that looks like a comment isn't one", () => {
	assert.deepEqual(found("const a = '// not one'; const b = `/* nor this */`;"), []);
});
