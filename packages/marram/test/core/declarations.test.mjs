// A core module's hand-written declarations (`<module>.d.mts`) name the same exports as the module, so TypeScript
// callers can't be told about a function that isn't there, or miss one that is. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const CORE = join(import.meta.dirname, "../../src/core");

/** The values a declaration file exports: functions, constants and classes, not types. */
function declaredValues(file) {
	const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
	const exported = (node) => ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
	return source.statements.filter(exported).flatMap((node) => {
		if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) return [node.name.text];
		if (ts.isVariableStatement(node)) return node.declarationList.declarations.map((declaration) => declaration.name.getText(source));
		return [];
	});
}

test("each core module's declarations match its exports", async () => {
	const pairs = readdirSync(CORE).filter((name) => name.endsWith(".d.mts")).map((name) => name.replace(/\.d\.mts$/, ".mjs"));
	assert.ok(pairs.length > 0);
	for (const module of pairs) {
		assert.ok(existsSync(join(CORE, module)), `${module} has declarations but no module`);
		const actual = Object.keys(await import(pathToFileURL(join(CORE, module)).href)).sort();
		assert.deepEqual([...new Set(declaredValues(join(CORE, module.replace(/\.mjs$/, ".d.mts"))))].sort(), actual, module);
	}
});
