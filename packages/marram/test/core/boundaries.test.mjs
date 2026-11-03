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

test("only a layer with builtins may import node: modules or electron", () => {
	for (const module of ["node:fs", "electron"]) {
		const problems = lint({ "features/a/client/View.tsx": `import x from "${module}";` });
		assert.equal(problems.length, 1, module);
		assert.match(problems[0], new RegExp(`may not import ${module}`));
	}
	assert.deepEqual(lint({ "main.ts": `import { app } from "electron";` }), []);
});

test("another feature is reached only through an index: its own, or a side's", () => {
	const files = { "features/b/index.ts": "export const b = 1;", "features/b/host/index.ts": "export const h = 1;", "features/b/host/inside.ts": "export const c = 1;" };
	assert.deepEqual(lint({ ...files, "features/a/host/x.ts": `import { b } from "../../b/index.ts";` }), []);
	assert.deepEqual(lint({ ...files, "main.ts": `import { h } from "./features/b/host/index.ts";` }), []);
	const inside = lint({ ...files, "features/a/host/x.ts": `import { c } from "../../b/host/inside.ts";` });
	assert.equal(inside.length, 1);
	assert.match(inside[0], /reaches inside features\/b: import an index\.ts/);
});

test("a listed import is allowed, and the list only shrinks", () => {
	const bad = { "features/a/client/V.tsx": `import { x } from "../host/s.ts";`, "features/a/host/s.ts": "export const x = 1;" };
	assert.deepEqual(lint(bad, { "features/a/client/V.tsx -> ../host/s.ts": "being moved" }), []);
	assert.deepEqual(lint({ "features/a/host/s.ts": "" }, { "features/a/client/V.tsx -> ../host/s.ts": "being moved" }), ["features/a/client/V.tsx -> ../host/s.ts is no longer imported that way: remove it from rules.mjs"]);
});
