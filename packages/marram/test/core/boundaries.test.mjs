// The import graph as a rule: layers, features through their index, and builtins only where they run.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { importBoundaries } from "../../src/core/boundaries.mjs";

const LAYERS = {
	"features/*/shared": { may: [] },
	"features/*/host": { may: ["features/*/shared"], builtins: true },
	"features/*/client": { may: ["features/*/shared"] },
};

function lint(files, allowed = {}) {
	const root = mkdtempSync(join(tmpdir(), "marram-boundaries-"));
	try {
		for (const [path, code] of Object.entries(files)) {
			mkdirSync(dirname(join(root, "src", path)), { recursive: true });
			writeFileSync(join(root, "src", path), code);
		}
		return importBoundaries({ root, folder: "src", layers: LAYERS, allowed, list: "rules.mjs" });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("a layer imports its own and the layers it lists", () => {
	assert.deepEqual(lint({
		"features/a/shared/api.ts": "export type A = 1;",
		"features/a/host/store.ts": `import type { A } from "../shared/api.ts"; import { x } from "./other.ts"; import { y } from "node:fs";`,
		"features/a/host/other.ts": "export const x = 1;",
		"features/a/client/View.tsx": `import type { A } from "../shared/api.ts"; import { useState } from "react";`,
	}), []);
});

test("a client can't import the host, and shared can't import either, however it's written", () => {
	const flagged = (code, file = "features/a/client/View.tsx") => lint({ "features/a/host/store.ts": "export const x = 1;", "features/a/client/View.tsx": "", "features/a/shared/api.ts": "", [file]: code });
	assert.equal(flagged(`import { x } from "../host/store.ts";`).length, 1);
	assert.match(flagged(`import { x } from "../host/store.ts";`)[0], /^src\/features\/a\/client\/View\.tsx:1 features\/\*\/client may not import from features\/\*\/host: move the code/);
	assert.equal(flagged(`import type { x } from "../host/store.ts";`).length, 1);
	assert.equal(flagged(`export { x } from "../host/store.ts";`).length, 1);
	assert.equal(flagged(`const x = import("../host/store.ts");`).length, 1);
	assert.equal(flagged(`import { x } from "../client/View.tsx";`, "features/a/shared/api.ts").length, 1);
});

test("only a layer with builtins may import Node's modules, however they're written, or electron", () => {
	for (const module of ["node:fs", "fs", "fs/promises", "child_process", "electron", "electron/main"]) {
		const problems = lint({ "features/a/client/View.tsx": `import x from "${module}";` });
		assert.equal(problems.length, 1, module);
		assert.match(problems[0], new RegExp(`may not import ${module}`));
	}
	assert.deepEqual(lint({ "main.ts": `import { app } from "electron";` }), []);
	assert.deepEqual(lint({ "features/a/host/x.ts": `import fs from "fs";` }), []);
	assert.deepEqual(lint({ "features/a/client/View.tsx": `import x from "electron-log"; import y from "fsevents";` }), []);
});

test("another feature is reached only through an index: its own, or a side's", () => {
	const files = { "features/b/index.ts": "export const b = 1;", "features/b/host/index.ts": "export const h = 1;", "features/b/host/inside.ts": "export const c = 1;" };
	assert.deepEqual(lint({ ...files, "features/a/host/x.ts": `import { b } from "../../b/index.ts";` }), []);
	assert.deepEqual(lint({ ...files, "main.ts": `import { h } from "./features/b/host/index.ts";` }), []);
	const inside = lint({ ...files, "features/a/host/x.ts": `import { c } from "../../b/host/inside.ts";` });
	assert.equal(inside.length, 1);
	assert.match(inside[0], /reaches inside features\/b: import an index\.ts/);
});

test("an index doesn't open a side the layer may not import", () => {
	const files = { "features/b/host/index.ts": "export const h = 1;", "features/b/shared/index.ts": "export const s = 1;", "features/b/client/index.ts": "export const c = 1;" };
	const crossing = lint({ ...files, "features/a/client/View.tsx": `import { h } from "../../b/host/index.ts";` });
	assert.equal(crossing.length, 1);
	assert.match(crossing[0], /features\/\*\/client may not import from features\/\*\/host/);
	assert.equal(lint({ ...files, "features/a/shared/api.ts": `import { c } from "../../b/client/index.ts";` }).length, 1);
	assert.deepEqual(lint({ ...files, "features/a/client/View.tsx": `import { s } from "../../b/shared/index.ts"; import { c } from "../../b/client/index.ts";` }), []);
});

test("a file in no layer doesn't open what it imports", () => {
	const root = { "features/b/host/index.ts": "export const h = 1;", "features/b/shared/index.ts": "export const s = 1;", "features/b/index.ts": `export { h } from "./host/index.ts";` };
	const client = (code) => lint({ ...root, "features/a/client/View.tsx": code });
	for (const specifier of ["../../b/index.ts", "../../b"]) {
		const problems = client(`import { h } from "${specifier}";`);
		assert.equal(problems.length, 1, specifier);
		assert.match(problems[0], /features\/\*\/client may not import from features\/\*\/host \(through features\/b\/index\.ts\)/);
	}
	assert.deepEqual(lint({ ...root, "features/a/host/x.ts": `import { h } from "../../b/index.ts";` }), []);
	assert.deepEqual(lint({ ...root, "features/b/index.ts": `export { s } from "./shared/index.ts";`, "features/a/client/View.tsx": `import { s } from "../../b/index.ts";` }), []);

	const helper = { "util.ts": `import fs from "node:fs"; export const f = fs;`, "paths.ts": `export { f } from "./util.ts";` };
	const chained = lint({ ...helper, "features/a/client/View.tsx": `import { f } from "../../../paths.ts";` });
	assert.equal(chained.length, 1);
	assert.match(chained[0], /features\/\*\/client may not import node:fs, which needs a host \(through util\.ts\) \(through paths\.ts\)/);
	assert.equal(lint({ ...helper, "features/a/client/View.tsx": `import { f } from "../../../paths.js";` }).length, 1);
	assert.deepEqual(lint({ ...helper, "features/a/host/x.ts": `import { f } from "../../../paths.ts";` }), []);
});

test("files in no layer that import each other end the walk", () => {
	const loop = { "one.ts": `export { two } from "./two.ts"; export const one = 1;`, "two.ts": `export { one } from "./one.ts"; export const two = 2;` };
	assert.deepEqual(lint({ ...loop, "features/a/client/View.tsx": `import { one } from "../../../one.ts";` }), []);
});

test("a listed import is allowed, and the list only shrinks", () => {
	const bad = { "features/a/client/V.tsx": `import { x } from "../host/s.ts";`, "features/a/host/s.ts": "export const x = 1;" };
	assert.deepEqual(lint(bad, { "features/a/client/V.tsx -> ../host/s.ts": "being moved" }), []);
	assert.deepEqual(lint({ "features/a/host/s.ts": "" }, { "features/a/client/V.tsx -> ../host/s.ts": "being moved" }), ["features/a/client/V.tsx -> ../host/s.ts is no longer imported that way: remove it from rules.mjs"]);
});
