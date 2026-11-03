// A rejection nobody hears ends a Node process: Node exits on an unhandled rejection, taking everything it was doing
// with it. `void work()` reads as handled while it isn't: it silences the linter, not the rejection. So a promise is awaited, returned, given a `.catch` (or `.then` with a rejection handler), or handed to
// `background(label, work)` (./background.ts), which logs a failure under its label. Also flagged: an async function
// passed where its caller drops the result, written in place (`emitter.on("x", async () => …)`) or by name
// (`setInterval(poll)`, `onClick={save}`), which floats the same way.
//
// There is no exception list: a site that floats is fixed. Promises kept in a variable and dropped aren't seen; a
// process-wide `unhandledRejection` handler (`hearRejections` in ./background.ts) logs those.
import { relative, resolve } from "node:path";
import ts from "typescript";
import { lineOf } from "../core/ratchet.mjs";

export const FIX = "await it, return it, .catch it, or hand it to background(label, work) from @raresportan/marram/node/background";

/** A program for `config`, as `tsc -p` builds it. */
function programOf(config) {
	const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (diagnostic) => { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")); } });
	return ts.createProgram(parsed.fileNames, parsed.options);
}

/** Whether a value of `type` may be a promise: anything with a `then`. */
function thenable(type) {
	return type.isUnion() ? type.types.some(thenable) : type.getProperty("then") !== undefined;
}

/** Whether `expression` already deals with a rejection: `.catch(…)`, `.then(…, onRejected)`, or `.finally` on one of those. */
function handled(expression) {
	if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) return false;
	const name = expression.expression.name.text;
	if (name === "catch") return true;
	if (name === "then") return expression.arguments.length >= 2;
	return name === "finally" && handled(expression.expression.expression);
}

/** Whether `expression` keeps its value (`tail = work()`, `loading ??= read()`): kept, not dropped. */
function assignment(expression) {
	return ts.isBinaryExpression(expression) && expression.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && expression.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
}

/** Whether a function's result is dropped by the call it's passed to: the parameter's type returns `void`. */
function droppedResult(checker, fn) {
	const expected = checker.getContextualType(fn)?.getCallSignatures()[0];
	return expected !== undefined && (checker.getReturnTypeOfSignature(expected).flags & ts.TypeFlags.Void) !== 0;
}

const isAsync = (fn) => fn.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true;

/** Why a statement floats a promise: `void work()`, or `work()` alone. */
function statementFloats(node, floats) {
	const expression = node.expression;
	if (ts.isVoidExpression(expression)) return floats(expression.expression) ? "`void` doesn't handle a rejection" : undefined;
	return !ts.isAwaitExpression(expression) && !assignment(expression) && floats(expression) ? "promise not awaited or caught" : undefined;
}

/** Why a function passed to a call floats one: it's async and the call drops what it returns. */
function callbackFloats(node, checker) {
	const passed = ts.isCallExpression(node.parent) && node.parent.arguments.includes(node);
	return passed && isAsync(node) && droppedResult(checker, node) ? "async function passed where its promise is dropped" : undefined;
}

/** Whether `node` is handed to something: a call's argument, or a JSX attribute's value (`onClick={save}`). */
function handed(node) {
	const parent = node.parent;
	if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(node)) return true;
	return ts.isJsxExpression(parent) && parent.expression === node && ts.isJsxAttribute(parent.parent);
}

/** Why a function handed over by name floats one: it returns a promise, and the receiver drops it (`setInterval(poll)`). */
function referenceFloats(node, checker) {
	if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || !handed(node)) return undefined;
	const signatures = checker.getTypeAtLocation(node).getCallSignatures();
	const returnsPromise = signatures.length > 0 && signatures.every((signature) => thenable(checker.getReturnTypeOfSignature(signature)));
	return returnsPromise && droppedResult(checker, node) ? "async function passed where its promise is dropped" : undefined;
}

/** Why an arrow's expression body floats one: it's its result, so `() => void work()` drops it, as does a caller that ignores it. */
function bodyFloats(node, checker, floats) {
	const body = node.body;
	if (ts.isVoidExpression(body)) return floats(body.expression) ? "`void` doesn't handle a rejection" : undefined;
	return !isAsync(node) && floats(body) && droppedResult(checker, node) ? "promise returned where it's dropped" : undefined;
}

/** What floats in `source`, as `line: why: code`. */
function floating(checker, source) {
	const found = [];
	const report = (node, why) => why !== undefined && found.push(`${lineOf(source, node)}: ${why}: ${node.getText(source).split("\n")[0].slice(0, 100)}`);
	const floats = (expression) => thenable(checker.getTypeAtLocation(expression)) && !handled(expression);
	const visit = (node) => {
		if (ts.isExpressionStatement(node)) report(node, statementFloats(node, floats));
		if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) report(node, callbackFloats(node, checker));
		else if (ts.isExpression(node)) report(node, referenceFloats(node, checker));
		if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) report(node.body, bodyFloats(node, checker, floats));
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

/**
 * The floating promises in each project (`{ config: its tsconfig, folder: the part of it linted }`, paths from `root`),
 * as `path:line: why: code`; and how many files were linted.
 */
export function lintPromises({ root, projects }) {
	const problems = [];
	let files = 0;
	for (const { config, folder } of projects) {
		const program = programOf(resolve(root, config));
		const checker = program.getTypeChecker();
		const base = resolve(root, folder);
		for (const source of program.getSourceFiles()) {
			if (source.isDeclarationFile || !source.fileName.startsWith(`${base}/`)) continue;
			files++;
			for (const line of floating(checker, source)) problems.push(`${relative(root, source.fileName)}:${line}`);
		}
	}
	return { files, problems };
}
