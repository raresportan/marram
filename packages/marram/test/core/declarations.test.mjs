// A module's hand-written declarations (`<module>.d.mts`) name the same exports as the module, so TypeScript callers
// can't be told about a function that isn't there, or miss one that is; and every .mjs entry the package exports has
// them, so a TypeScript project importing it isn't left with `any`. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import ts from "../../src/core/typescript.mjs";

const PKG = join(import.meta.dirname, "../..");
const SRC = join(PKG, "src");

/** The declaration files under `folder`. */
function declarationFiles(folder) {
	return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
		const path = join(folder, entry.name);
		if (entry.isDirectory()) return declarationFiles(path);
		return entry.name.endsWith(".d.mts") ? [path] : [];
	});
}

/** The values a declaration file exports (functions, constants and classes, not types), `export *` included. */
function declaredValues(file) {
	const program = ts.createProgram([file], { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, noEmit: true });
	const checker = program.getTypeChecker();
	return checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(file)))
		.filter((symbol) => ((symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol).flags & ts.SymbolFlags.Value) !== 0)
		.map((symbol) => symbol.name)
		.sort();
}

test("each module's declarations match its exports", async () => {
	const files = declarationFiles(SRC);
	assert.ok(files.length > 0);
	for (const file of files) {
		const module = file.replace(/\.d\.mts$/, ".mjs");
		const name = relative(PKG, module);
		assert.ok(existsSync(module), `${name} has declarations but no module`);
		const actual = Object.keys(await import(pathToFileURL(module).href)).sort();
		assert.deepEqual(declaredValues(file), actual, name);
	}
});

test("every .mjs entry the package exports has declarations", () => {
	const { exports } = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
	const entries = Object.values(exports).filter((target) => typeof target === "string" && target.endsWith(".mjs"));
	assert.ok(entries.length > 0);
	for (const entry of entries) assert.ok(existsSync(join(PKG, entry.replace(/\.mjs$/, ".d.mts"))), `${entry} has no .d.mts beside it`);
});
