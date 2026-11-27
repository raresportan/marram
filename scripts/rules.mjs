#!/usr/bin/env node
// Marram's own ratchets, for mistakes it has made more than once (docs/mistake-classes.md):
//   - lifetime: a command that calls process.exit straight after writing can cut its output short, since to a pipe a
//     write finishes later (on macOS). Exits go through exitWhenWritten, which waits for them.
//   - check: a pattern a project gives may have the g or y flag, and then test() and exec() start where its last match
//     ended. A pattern the file didn't write is matched through pattern.mjs, which starts from the text's start.
import { resolve } from "node:path";
import ts from "typescript";
import { finish, lineOf, runRules } from "@raresportan/marram/core/ratchet";

const root = resolve(import.meta.dirname, "..");
const list = "scripts/rules.mjs";
// The hand-written modules and the TypeScript sources; what the build emits from them is the sources' to answer for.
const match = /^(?!.*\.d\.m?ts$).*\.(?:mjs|ts)$/;

/** Every call in `source` that `pick(call)` keeps, as a site. */
const calls = (source, pick, what) => {
	const sites = [];
	const visit = (node) => {
		if (ts.isCallExpression(node) && pick(node)) sites.push({ line: lineOf(source, node), what: what(node) });
		ts.forEachChild(node, visit);
	};
	visit(source);
	return sites;
};

const isProcessExit = (call) => ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "exit"
	&& ts.isIdentifier(call.expression.expression) && call.expression.expression.text === "process";
const exits = (source) => calls(source, isProcessExit, () => "calls process.exit");

/** A pattern written here: a literal, or `new RegExp(…)`. */
const isWritten = (node) => ts.isRegularExpressionLiteral(node) || (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "RegExp");

/** The names the file binds to a pattern it writes, or to an arrow function that returns one it writes. */
function ownPatterns(source) {
	const values = new Set();
	const makers = new Set();
	const visit = (node) => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			if (isWritten(node.initializer)) values.add(node.name.text);
			if (ts.isArrowFunction(node.initializer) && isWritten(node.initializer.body)) makers.add(node.name.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return { values, makers };
}

const isMatchCall = (call) => ts.isPropertyAccessExpression(call.expression) && ["test", "exec"].includes(call.expression.name.text);
function patterns(source) {
	const { values, makers } = ownPatterns(source);
	const written = (receiver) => {
		const value = ts.isParenthesizedExpression(receiver) ? receiver.expression : receiver;
		return isWritten(value) || (ts.isIdentifier(value) && values.has(value.text))
			|| (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && makers.has(value.expression.text));
	};
	return calls(source, (call) => isMatchCall(call) && !written(call.expression.expression), (call) => `calls ${call.expression.getText(source)} on a pattern it didn't write`);
}

const rules = [
	{ find: exits, owners: ["core/json-output.mjs"], allowed: {}, fix: "await exitWhenWritten (json-output.mjs), which exits once the output is written", stale: "no longer calls process.exit" },
	{ find: patterns, owners: ["core/pattern.mjs"], allowed: {}, fix: "match it with matches or firstMatch (pattern.mjs), from the text's start", stale: "no longer matches a pattern it didn't write" },
];

const problems = [
	...runRules({ root, folder: "packages/marram/src", list, rules, match }),
	...runRules({ root, folder: "packages/marram/bin", list, rules, match }),
];
await finish("rules", problems, "exits wait for the output, and patterns a project gives match from the start");
