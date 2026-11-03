// A check runner judges a check by its exit code alone, so a check that prints what it saw without asserting it passes
// whatever the code does, even while a feature map cites it. So a check file must be able to fail on what it sees: a
// `node:assert` call, a `throw` (in it or in a helper it defines), or a non-zero exit (`process.exit(1)`,
// `process.exitCode = 1`). A crash alone doesn't count.
//
// And waits go through `until` (./until.ts). A loop that sleeps until something holds is a wait of the check's own:
// each one has its own bound and a failure that says neither how long it waited nor what it saw, and some run on when
// time is up as though what they waited for had happened. An upper bound on elapsed time (`Date.now() - started < 900`)
// is a guess at the machine's speed that fails under load: `sooner` measures it against how long the broken behaviour
// takes instead.
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { lineOf, parse } from "./ratchet.mjs";

export const WAITS = "@raresportan/marram/core/until";

/** The names an import clause binds: its default, its namespace, or each named import. */
function bound(clause) {
	const bindings = clause?.namedBindings;
	if (bindings !== undefined && ts.isNamespaceImport(bindings)) return [clause.name?.text, bindings.name.text];
	return [clause?.name?.text, ...(bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements.map((element) => element.name.text) : [])];
}

/** The names `source` binds to `node:assert`, or to `waits`, whose waits fail when time is up. */
function assertNames(source, waits) {
	const failing = (from) => /^(node:)?assert(\/strict)?$/.test(from) || from === waits;
	return new Set(source.statements.filter((statement) => ts.isImportDeclaration(statement) && failing(statement.moduleSpecifier.text)).flatMap((statement) => bound(statement.importClause)).filter(Boolean));
}

const isProcess = (node, property) => ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "process" && node.name.text === property;
const nonZero = (node) => node !== undefined && !(ts.isNumericLiteral(node) && node.text === "0");

/** How `node` can fail the check, or undefined. */
function failure(node, asserts) {
	if (ts.isThrowStatement(node)) return "throw";
	if (ts.isCallExpression(node)) {
		const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.expression : node.expression;
		if (ts.isIdentifier(callee) && asserts.has(callee.text)) return "assert";
		if (isProcess(node.expression, "exit") && nonZero(node.arguments[0])) return "exit";
	}
	if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && isProcess(node.left, "exitCode") && nonZero(node.right)) return "exit";
	return undefined;
}

function canFail(source, waits) {
	const asserts = assertNames(source, waits);
	let found = false;
	const visit = (node) => {
		if (found) return;
		if (failure(node, asserts) !== undefined) found = true;
		else ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

const isNow = (node) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "now" && ts.isIdentifier(node.expression.expression) && ["Date", "performance"].includes(node.expression.expression.text);
const contains = (node, test) => test(node) || (ts.forEachChild(node, (child) => (contains(child, test) ? true : undefined)) ?? false);
/** A time measured from a clock: `Date.now() - started`, or a name holding one. */
const isElapsed = (node, elapsed) => contains(node, (part) =>
	(ts.isBinaryExpression(part) && part.operatorToken.kind === ts.SyntaxKind.MinusToken && contains(part.left, isNow)) || (ts.isIdentifier(part) && elapsed.has(part.text)));
/** Waiting on a timer: `setTimeout`, or a helper named for sleeping. */
const isTimer = (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^(setTimeout|sleep|wait|delay)$/.test(node.expression.text);
/**
 * A loop that can go round until something holds. A loop over a list (`for…of`) runs its cases, sleeping between steps
 * to stage a race, and isn't one; nor is a loop with a `// Not a wait:` comment saying what it is (a retry).
 */
const isOpenLoop = (node, source) =>
	(ts.isForStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) &&
	!(ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? []).some((range) => source.text.slice(range.pos, range.end).includes("Not a wait:"));

/** The waits and time bounds `source` has of its own, with their lines. */
function ownWaits(source, waits) {
	const elapsed = new Set();
	const found = [];
	const visit = (node) => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined && isElapsed(node.initializer, elapsed)) elapsed.add(node.name.text);
		if (isOpenLoop(node, source) && contains(node, (part) => ts.isAwaitExpression(part) && contains(part, isTimer))) {
			found.push(`line ${lineOf(source, node)}: a loop that sleeps until something holds: wait with until() from ${waits}, which says what it saw`);
			return;
		}
		if (ts.isBinaryExpression(node)) {
			const kind = node.operatorToken.kind;
			const below = [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken].includes(kind) ? node.left : [ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(kind) ? node.right : undefined;
			if (below !== undefined && isElapsed(below, elapsed)) found.push(`line ${lineOf(source, node)}: an upper bound on elapsed time fails under load: use sooner() from ${waits}, measured against how long the broken behaviour takes`);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

/** What's wrong with one check's `source`: it can't fail, or it waits or bounds time on its own. `waits` is where `until` comes from. */
export function checkProblems(source, waits = WAITS) {
	return [
		...(canFail(source, waits) ? [] : ["asserts nothing, so it passes whatever the code does: assert what it sees (node:assert), throw, or exit non-zero"]),
		...ownWaits(source, waits),
	];
}

/** Problems in each file of `root`/`folder` whose name `match`es, as `path, problem`; and how many files there were. */
export function lintChecks({ root, folder, match, waits = WAITS }) {
	const base = join(root, folder);
	const files = readdirSync(base).filter((name) => match.test(name)).map((name) => join(base, name));
	return { files: files.length, problems: files.flatMap((file) => checkProblems(parse(file), waits).map((problem) => `${relative(root, file)}: ${problem}`)) };
}
