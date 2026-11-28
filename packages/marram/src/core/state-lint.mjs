// A lifecycle kept in variables that callbacks set is a state machine nobody wrote down (docs/mistake-classes.md,
// `state`): a function whose callbacks assign two or more of its `let` variables keeps one, and it belongs in a table
// (machine.mjs). Names are resolved to what they declare, through TypeScript's checker: a callback's parameter named
// like the outer variable is another variable, and `event.ready` is a property, not the outer `ready`.
import ts from "typescript";

/**
 * A program over `paths` for resolving names within each file: JavaScript included, no lib and no module resolution,
 * which a name declared in the same file doesn't need.
 */
export const programOf = (paths) => ts.createProgram(paths, { allowJs: true, checkJs: false, noLib: true, noResolve: true, types: [], noEmit: true });

const isFunction = (node) => ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
	|| ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);

/** What `node`, an identifier, names: the variable a shorthand property `{ x }` reads, not the property. */
const named = (checker, node) => (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node));

/** Whether `node` reads the variable `symbol`. */
function reads(checker, node, symbol) {
	if (ts.isIdentifier(node) && named(checker, node) === symbol) return true;
	return ts.forEachChild(node, (child) => reads(checker, child, symbol) || undefined) ?? false;
}

/**
 * The functions in `source` (a file of `program`) whose callbacks assign two or more of their `let` variables, as
 * sites: `{ line, what }`. An assignment that reads the variable it sets (`out = out + chunk`, `queue = queue.then(…)`)
 * gathers rather than saying what state it's in, so it doesn't count, nor does `+=`.
 */
export function eventStates(source, checker) {
	const sites = [];
	const visit = (node) => {
		if (isFunction(node) && node.body) {
			// Its own `let` variables, not those of the functions inside it.
			const own = new Map();
			const declare = (inner) => {
				if (isFunction(inner)) return;
				if (ts.isVariableDeclarationList(inner) && (inner.flags & ts.NodeFlags.Let) !== 0) {
					for (const { name } of inner.declarations) if (ts.isIdentifier(name)) own.set(checker.getSymbolAtLocation(name), name);
				}
				ts.forEachChild(inner, declare);
			};
			ts.forEachChild(node.body, declare);
			own.delete(undefined);
			const set = new Set();
			// Assignments inside the functions it holds, however deep.
			const assigns = (inner, inCallback) => {
				if (inCallback && ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(inner.left)) {
					const symbol = checker.getSymbolAtLocation(inner.left);
					if (own.has(symbol) && !reads(checker, inner.right, symbol)) set.add(symbol);
				}
				ts.forEachChild(inner, (child) => assigns(child, inCallback || isFunction(child)));
			};
			ts.forEachChild(node.body, (child) => assigns(child, isFunction(child)));
			if (set.size >= 2) {
				const names = [...set].map((symbol) => own.get(symbol));
				const line = source.getLineAndCharacterOfPosition(names[0].getStart(source)).line + 1;
				sites.push({ line, what: `${names.map((name) => name.text).join(", ")} are set by callbacks` });
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return sites;
}
