// A journey's check that reads the app reads it through a function, which the check polls: an `await` inside a plain
// boolean reads once, racing whatever the app is still doing.
// A check given a function returns a promise, so it must be awaited, or the journey goes on, and may end, before it's
// recorded. Whether a check polls is its argument's type (a function, written in place or named), so the type checker
// decides it, not the syntax.
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { lineOf } from "../core/ratchet.mjs";
import ts from "typescript";

const isFunction = (node) => ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node);
/** Awaits something itself, not in a function it defines. */
const awaitsHere = (node) => ts.isAwaitExpression(node) || (!isFunction(node) && (ts.forEachChild(node, (child) => (awaitsHere(child) ? true : undefined)) ?? false));

/**
 * The checks in `source` (calls `<session>.check(label, ok, detail?)`) that read once, or whose polling nobody waits
 * for, with their lines.
 */
export function readOnce(source, checker, session = "session") {
	const found = [];
	const visit = (node) => {
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "check" && node.expression.expression.getText(source) === session) {
			const [, ok, detail] = node.arguments;
			const polled = ok !== undefined && (ts.isSpreadElement(ok) || checker.getTypeAtLocation(ok).getCallSignatures().length > 0);
			const line = lineOf(source, node);
			if (ok !== undefined && !polled && awaitsHere(ok)) found.push(`line ${line}: reads once, inside the check: pass a function, which the check polls until it holds`);
			if (polled && detail !== undefined && !isFunction(detail) && awaitsHere(detail)) found.push(`line ${line}: reads its details before the check polls: pass them as a function, read on failure`);
			if (polled && !ts.isAwaitExpression(node.parent)) found.push(`line ${line}: a polled check nobody awaits: the journey goes on, and may end, before it's recorded`);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

/** Problems in the journeys (`.ts` files) of `root`/`folder`, type-checked with `tsconfig`'s options; and how many there were. */
export function lintJourneys({ root, folder, tsconfig, session = "session" }) {
	const base = join(root, folder);
	const files = readdirSync(base).filter((name) => name.endsWith(".ts")).map((name) => join(base, name));
	const config = ts.getParsedCommandLineOfConfigFile(join(root, tsconfig), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
	if (config === undefined) throw new Error(`Can't read ${tsconfig}`);
	const program = ts.createProgram(files, config.options);
	const checker = program.getTypeChecker();
	return { files: files.length, problems: files.flatMap((file) => readOnce(program.getSourceFile(file), checker, session).map((problem) => `${relative(root, file)}: ${problem}`)) };
}
