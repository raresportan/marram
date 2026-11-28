// The no-comments rule: doc comments, license headers and links stay; the rest goes. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "../../src/core/typescript.mjs";
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
	// A pattern's text is the pattern's: on TypeScript 7, whose tokens are scanned here, `\/\/` must not read as `//`.
	assert.deepEqual(found("const link = /https?:\\/\\//; const any = /a*/;"), []);
	const jsx = (code) => comments(ts.createSourceFile("x.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)).map(({ line }) => line);
	assert.deepEqual(jsx("const a = <p>see // here, /* and here */</p>;"), []);
	assert.deepEqual(jsx("const a = <p>// not one</p>;"), []);
	assert.deepEqual(jsx("const a = <p>\n\t// not one\n</p>;"), []);
	assert.deepEqual(jsx("const a = <p>{x}/* not one */<b>a</b>// nor this</p>;"), []);
	assert.deepEqual(jsx("const a = <p>{/* one */}</p>;\nconst b = <p>hi</p>; // and one"), [1, 2]);
});

test("a comment inside an expression, after a token rather than a node, is flagged", () => {
	assert.deepEqual(found("call(// why\n\t1,\n);"), [1]);
	assert.deepEqual(found("const a = cond ? /* why */ 1 : 2;"), [1]);
});

test("a doc comment counts only on a declaration a reader looks up, not in a function's body or on a statement", () => {
	assert.deepEqual(found(`function f() {\n\t/** workaround */\n\treturn 1;\n}`), [2]);
	assert.deepEqual(found(`function f() {\n\t/** workaround */\n\tconst a = 1;\n\treturn a;\n}`), [2]);
	assert.deepEqual(found(`const a = 1; /** after it */`), [1]);
	assert.deepEqual(found(`/** not a declaration */\nrun();`), [1]);
	assert.deepEqual(found(`const a = /** inside */ 1;`), [1]);
});

test("a doc comment on a module's, a class's, an interface's or an object's members counts", () => {
	assert.deepEqual(found(`/** A. */\nfunction a() {}\n/** B. */\nexport class B {\n\t/** C. */\n\tc = 1;\n\t/** D. */\n\td() {}\n}`), []);
	assert.deepEqual(found(`/** T. */\ninterface T {\n\t/** U. */\n\tu: number;\n}\n/** V. */\ntype V = T;\n/** E. */\nenum E {\n\t/** F. */\n\tF,\n}`), []);
	assert.deepEqual(found(`export default {\n\t/** How long. */\n\ttimeoutMs: 1,\n};`), []);
});
