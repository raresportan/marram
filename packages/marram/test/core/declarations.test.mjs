// A module's hand-written declarations (`<module>.d.mts`) name the same exports as the module, so TypeScript callers
// can't be told about a function that isn't there, or miss one that is; and every .mjs entry the package exports has
// them, so a TypeScript project importing it isn't left with `any`. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import ts, { release } from "../../src/core/typescript.mjs";

const PKG = join(import.meta.dirname, "../..");
const SRC = join(PKG, "src");
const require = createRequire(import.meta.url);

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
	try {
		const checker = program.getTypeChecker();
		return checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(file)))
			.filter((symbol) => ((symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol).flags & ts.SymbolFlags.Value) !== 0)
			.map((symbol) => symbol.name)
			.sort();
	} finally {
		release(program);
	}
}

test("each module's declarations match its exports", async () => {
	// The compiler's types, which the package imports as `#typescript-types`, are types only: they have no module.
	const { imports } = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
	const typesOnly = new Set(Object.values(imports).flatMap((target) => Object.values(target)).map((target) => join(PKG, target)));
	const files = declarationFiles(SRC).filter((file) => !typesOnly.has(file));
	assert.ok(files.length > 0 && typesOnly.size === 2);
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

test("a TypeScript project compiles against the package's declarations, and runs, on the TypeScript installed (5 here, 7.0 in CI's other job)", () => {
	const root = mkdtempSync(join(tmpdir(), "marram-consumer-"));
	try {
		const modules = join(root, "node_modules");
		mkdirSync(join(modules, "@raresportan"), { recursive: true });
		symlinkSync(PKG, join(modules, "@raresportan", "marram"), "junction");
		const typescript = dirname(require.resolve("typescript/package.json"));
		symlinkSync(typescript, join(modules, "typescript"), "junction");
		const seven = JSON.parse(readFileSync(join(typescript, "package.json"), "utf8")).version.startsWith("7.");
		writeFileSync(join(root, "package.json"), JSON.stringify({ name: "consumer", type: "module", private: true }));
		writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "nodenext", strict: true, noEmit: true, skipLibCheck: false, lib: ["esnext"], types: [] }, files: ["index.ts"] }));
		// A journey with a polled check nobody awaits, which readOnce reports, given the consumer's own checker.
		writeFileSync(join(root, "journey.ts"), `declare const session: { check(label: string, ok: () => boolean): Promise<void> };\nsession.check("ready", () => true);\n`);
		writeFileSync(join(root, "journey.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, files: ["journey.ts"] }));
		writeFileSync(join(root, "plugin.es6"), "// a comment\nconst x = 1;\n");
		// The consumer's checker for the journey: 5's program's, or 7.0's project's.
		const checked = seven
			? [
				`import { API } from "typescript/unstable/sync";`,
				`const project = new API().updateSnapshot({ openProjects: ["journey.json"] }).getProject("journey.json");`,
				`if (project === undefined) throw new Error("no project");`,
				`const journey = project.program.getSourceFile("journey.ts"), checker = project.checker;`,
			]
			: [
				`import ts from "typescript";`,
				`const program = ts.createProgram(["journey.ts"], { strict: true, noEmit: true, types: [] });`,
				`const journey = program.getSourceFile("journey.ts"), checker = program.getTypeChecker();`,
			];
		// Every declaration file that names the compiler's types, used as a consumer would; and one wrong use, which
		// must fail, so the types aren't \`any\`.
		const lines = [
			`import { parse, lineOf, restrict, runRules } from "@raresportan/marram/core/ratchet";`,
			`import { comments } from "@raresportan/marram/core/no-comments";`,
			`import { checkProblems } from "@raresportan/marram/core/check-lint";`,
			`import { importsOf } from "@raresportan/marram/core/boundaries";`,
			`import { readOnce } from "@raresportan/marram/core/journey-lint";`,
			`import { acquisitions } from "@raresportan/marram/node/resource-lint";`,
			`import { effectSets } from "@raresportan/marram/react/effect-lint";`,
			...checked,
			`if (journey === undefined) throw new Error("no journey");`,
			`const source = parse("journey.ts");`,
			`export const line: number = lineOf(source, source.statements[0]);`,
			`export const found = [comments(source), checkProblems(source), importsOf("fs")(source), acquisitions(source), effectSets(source)];`,
			`export const once: string[] = readOnce(journey, checker);`,
			`export { restrict, runRules };`,
			`export const wrong: string = source.statements;`,
		];
		writeFileSync(join(root, "index.ts"), lines.join("\n"));
		// The same, run: readOnce with the consumer's checker, and a rule whose finder reads the file's name.
		writeFileSync(join(root, "run.mjs"), [
			...lines.slice(0, -2).filter((line) => !line.startsWith("export const found")).map((line) => line.replace(/^export const (\w+): [\w[\]]+ =/, "const $1 =")),
			`const es6 = runRules({ root: ".", folder: ".", list: "rules.mjs", match: /\\.es6$/g, rules: [{ find: (tree) => (tree.fileName.endsWith(".es6") ? comments(tree) : []), allowed: {}, fix: "remove it", stale: "has none" }] });`,
			`console.log(JSON.stringify({ once, es6 }));`,
		].join("\n"));
		const tsc = spawnSync(process.execPath, [join(modules, "typescript", "bin", "tsc"), "-p", root], { cwd: root, encoding: "utf8" });
		const errors = tsc.stdout.split("\n").filter((line) => /error TS/.test(line));
		assert.equal(errors.length, 1, tsc.stdout + tsc.stderr);
		assert.match(errors[0], new RegExp(`index\\.ts\\(${lines.length},14\\): error TS2322`));
		// A project that only imports the lints compiles with the default lib: their declarations don't pull in 7's API
		// declarations, which need \`lib: esnext\` (the consumer above names them itself, for its checker).
		writeFileSync(join(root, "lints.ts"), lines.filter((line) => !checked.includes(line) && !/^if \(journey|readOnce|^export const wrong/.test(line)).join("\n"));
		writeFileSync(join(root, "lints.json"), JSON.stringify({ compilerOptions: { module: "nodenext", strict: true, noEmit: true, skipLibCheck: false, types: [] }, files: ["lints.ts"] }));
		const lints = spawnSync(process.execPath, [join(modules, "typescript", "bin", "tsc"), "-p", join(root, "lints.json")], { cwd: root, encoding: "utf8" });
		assert.equal(lints.status, 0, lints.stdout + lints.stderr);
		const run = spawnSync(process.execPath, ["run.mjs"], { cwd: root, encoding: "utf8" });
		assert.equal(run.status, 0, run.stderr);
		assert.deepEqual(JSON.parse(run.stdout), {
			once: ["line 2: a polled check nobody awaits: the journey goes on, and may end, before it's recorded"],
			es6: ["./plugin.es6:1 has a comment: remove it, or list it in rules.mjs with why"],
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
