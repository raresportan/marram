// The lints' TypeScript: version 5's compiler API, or 7.0's made to look like it, and a plain message on another.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const LOADER = fileURLToPath(new URL("../../src/core/typescript.mjs", import.meta.url));
const ADAPTER = fileURLToPath(new URL("../../src/core/typescript7.mjs", import.meta.url));

/** Loads the loader in a project whose typescript is a package of `version` with none of TypeScript's API. */
async function loadBeside(version) {
	const root = mkdtempSync(join(tmpdir(), "marram-typescript-"));
	try {
		const fake = join(root, "node_modules", "typescript");
		mkdirSync(fake, { recursive: true });
		writeFileSync(join(fake, "package.json"), JSON.stringify({ name: "typescript", version, main: "index.js" }));
		writeFileSync(join(fake, "index.js"), `module.exports = { version: ${JSON.stringify(version)} };\n`);
		mkdirSync(join(root, "lib"));
		copyFileSync(LOADER, join(root, "lib", "typescript.mjs"));
		copyFileSync(ADAPTER, join(root, "lib", "typescript7.mjs"));
		return await import(pathToFileURL(join(root, "lib", "typescript.mjs")).href);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("TypeScript 5's or 7.0's compiler API loads; another is named, with what to install instead", async () => {
	const ts = (await import(pathToFileURL(LOADER).href)).default;
	assert.equal(typeof ts.createSourceFile, "function");
	assert.equal(ts.createSourceFile("x.ts", "let a = 1;", ts.ScriptTarget.Latest, true).statements.length, 1);
	// A 7.0 without the API the adapter is built on (`typescript/unstable/*`), and a 7.1, whose API isn't adapted.
	for (const version of ["7.0.2", "7.1.0"]) {
		const named = new RegExp(`need TypeScript 5's compiler API \\(typescript@\\^5\\.9\\.3\\) or TypeScript 7\\.0's \\(typescript@~7\\.0\\.2\\), and this project has typescript ${version.replaceAll(".", "\\.")}.*npm install --save-dev typescript@5`);
		await assert.rejects(loadBeside(version), named);
	}
});
