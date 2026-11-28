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

// The rest holds on 5 as it is; on 7.0 it's what the adapter must do as 5 does.

test("a typed lint reads a file as it is on the disk, though it was parsed with other text before", async () => {
	const { parse } = await import("../../src/core/ratchet.mjs");
	const { lintPromises } = await import("../../src/node/promise-lint.mjs");
	const root = mkdtempSync(join(tmpdir(), "marram-reparse-"));
	try {
		writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, lib: ["es2022"] }, include: ["a.ts"] }));
		writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
		assert.equal(parse(join(root, "a.ts")).statements.length, 1);
		writeFileSync(join(root, "a.ts"), "Promise.resolve(1);\n");
		const { files, problems } = lintPromises({ root, projects: [{ config: "tsconfig.json", folder: "." }] });
		assert.equal(files, 1);
		assert.deepEqual(problems, ["a.ts:1: promise not awaited or caught: Promise.resolve(1);"]);
		// And parsed again, a file reads as it is now, not as it was first parsed.
		assert.equal(parse(join(root, "a.ts")).statements[0].getText(), "Promise.resolve(1);");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a file whose extension names no kind is parsed as the kind it's given, or as TypeScript", async () => {
	const ts = (await import(pathToFileURL(LOADER).href)).default;
	const { runRules } = await import("../../src/core/ratchet.mjs");
	const { comments } = await import("../../src/core/no-comments.mjs");
	const root = mkdtempSync(join(tmpdir(), "marram-kind-"));
	try {
		writeFileSync(join(root, "rule.es6"), "// a comment\nconst x = <b>1</b>;\n");
		const rule = { find: comments, allowed: {}, fix: "remove it", stale: "has none" };
		assert.deepEqual(runRules({ root, folder: ".", list: "rules.mjs", match: /\.es6$/g, rules: [rule] }), ["./rule.es6:1 has a comment: remove it, or list it in rules.mjs with why"]);
		const jsx = ts.createSourceFile(join(root, "rule.es6"), "const x = <b>1</b>;", ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
		assert.equal(jsx.languageVariant, ts.LanguageVariant.JSX);
		const unnamed = ts.createSourceFile(join(root, "notes.txt"), "let a: number = 1;", ts.ScriptTarget.Latest, true);
		assert.equal(unnamed.languageVariant, ts.LanguageVariant.Standard);
		assert.equal(unnamed.statements.length, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("on 7.0, parsing files and releasing programs leaves no compiler snapshot held", { skip: !(await import(pathToFileURL(LOADER).href)).default.liveSnapshots && "TypeScript 5 holds none" }, async () => {
	const ts = (await import(pathToFileURL(LOADER).href)).default;
	const { runRules } = await import("../../src/core/ratchet.mjs");
	const { lintPromises } = await import("../../src/node/promise-lint.mjs");
	const root = mkdtempSync(join(tmpdir(), "marram-snapshots-"));
	try {
		writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true, lib: ["es2022"] }, include: ["*.ts"] }));
		for (let i = 0; i < 20; i++) writeFileSync(join(root, `f${i}.ts`), `export const a${i} = ${i};\n`);
		runRules({ root, folder: ".", list: "rules.mjs", rules: [{ find: () => [], allowed: {}, fix: "", stale: "" }] });
		lintPromises({ root, projects: [{ config: "tsconfig.json", folder: "." }] });
		// One stays: the snapshot the last parse ended on, which the next parse lets go.
		assert.equal(ts.liveSnapshots(), 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
