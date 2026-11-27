// React state that disagrees with itself (a draft from the last page, a selection a frame behind) comes from
// state copied from other state by an effect: the effect runs after the render that showed the stale copy, then renders
// again, and which copy wins can depend on the order effects run in. Derive the value while rendering, give the
// component a `key` that resets it, hold it with the key it was loaded for (`useKeyed`, ./keyed.ts), or adjust it while
// rendering (React's "storing information from previous renders") instead.
//
// So an effect (`useEffect`, `useLayoutEffect`) may not call a `useState` setter of its component in its own body. A
// setter called inside a function the effect hands on (a subscription's listener, a timer, a request's `.then`) is what
// effects are for, and is fine. Some effects rightly set state from outside React (the DOM measured, the clock): a
// project lists those with why, using `ratchet` from @raresportan/marram/core/ratchet.
import ts from "typescript";
import { lineOf } from "../core/ratchet.mjs";

const EFFECTS = new Set(["useEffect", "useLayoutEffect"]);

/** The names `source` gives React's own module: `React`, and what it imports from "react" whole (`* as R`, `R`). */
function reactNamespaces(source) {
	const names = new Set(["React"]);
	for (const statement of source.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "react") continue;
		const clause = statement.importClause;
		if (clause?.name !== undefined) names.add(clause.name.text);
		if (clause?.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings)) names.add(clause.namedBindings.name.text);
	}
	return names;
}

/**
 * The hook `call` calls, bare or on React's namespace (`useState`, `React.useState`), or undefined. A method of the
 * same name on anything else (`store.useEffect(…)`) isn't React's.
 */
function hookOf(call, namespaces) {
	const callee = call.expression;
	if (ts.isIdentifier(callee)) return callee.text;
	if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text)) return callee.name.text;
	return undefined;
}

/** Each node in `scope`'s own body, not in a function it creates. */
function eachOwn(scope, see) {
	const visit = (node) => {
		if (ts.isFunctionLike(node)) return;
		see(node);
		ts.forEachChild(node, visit);
	};
	if (ts.isSourceFile(scope)) ts.forEachChild(scope, visit);
	else if (scope.body !== undefined) ts.forEachChild(scope.body, visit);
}

/** The setters `const [value, setValue] = useState(…)` declares in `scope` itself: its component's or hook's state. */
function setters(scope, namespaces) {
	const found = new Set();
	eachOwn(scope, (node) => {
		if (!ts.isVariableDeclaration(node) || !ts.isArrayBindingPattern(node.name) || node.initializer === undefined || !ts.isCallExpression(node.initializer)) return;
		const setter = node.name.elements[1];
		if (hookOf(node.initializer, namespaces) === "useState" && setter !== undefined && ts.isBindingElement(setter) && ts.isIdentifier(setter.name)) found.add(setter.name.text);
	});
	return found;
}

/** Calls to `names` in `body` itself (a block, or an arrow's expression), not in a function it creates. */
function directCalls(body, names) {
	const calls = [];
	const visit = (node) => {
		if (ts.isFunctionLike(node)) return;
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text)) calls.push(node);
		ts.forEachChild(node, visit);
	};
	visit(body);
	return calls;
}

/** Where an effect in `source` sets its component's state in its own body: `{ line, effect, setter }`. */
export function effectSets(source) {
	const found = [];
	const namespaces = reactNamespaces(source);
	// Each component or hook (and the file itself) with its own setters, so one component's setter isn't another's.
	const scopes = [source];
	const collect = (node) => {
		if (ts.isFunctionLike(node)) scopes.push(node);
		ts.forEachChild(node, collect);
	};
	ts.forEachChild(source, collect);
	for (const scope of scopes) {
		const own = setters(scope, namespaces);
		if (own.size === 0) continue;
		eachOwn(scope, (node) => {
			if (!ts.isCallExpression(node) || !EFFECTS.has(hookOf(node, namespaces))) return;
			const effect = node.arguments[0];
			if (effect === undefined || !(ts.isArrowFunction(effect) || ts.isFunctionExpression(effect))) return;
			for (const call of directCalls(effect.body, own)) found.push({ line: lineOf(source, call), effect: hookOf(node, namespaces), setter: call.expression.text });
		});
	}
	return found.sort((a, b) => a.line - b.line);
}
