// The lints' TypeScript: version 5's compiler API, and a plain message on another. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const LOADER = fileURLToPath(new URL("../../src/core/typescript.mjs", import.meta.url));

test("TypeScript 5's compiler API loads; another is named, with what to install instead", async () => {
	assert.equal(typeof (await import(pathToFileURL(LOADER).href)).default.createSourceFile, "function");
	// A project whose typescript is 7's: its JavaScript API has no createSourceFile.
	const root = mkdtempSync(join(tmpdir(), "marram-typescript-"));
	try {
		const fake = join(root, "node_modules", "typescript");
		mkdirSync(fake, { recursive: true });
		writeFileSync(join(fake, "package.json"), JSON.stringify({ name: "typescript", version: "7.0.2", main: "index.js" }));
		writeFileSync(join(fake, "index.js"), "module.exports = { version: '7.0.2' };\n");
		mkdirSync(join(root, "lib"));
		copyFileSync(LOADER, join(root, "lib", "typescript.mjs"));
		await assert.rejects(import(pathToFileURL(join(root, "lib", "typescript.mjs")).href), /need TypeScript 5's compiler API \(typescript@\^5\.9\.3\), and this project has typescript 7\.0\.2.*npm install --save-dev typescript@5/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
