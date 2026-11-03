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

/** The setters `const [value, setValue] = useState(…)` declares in `source`. */
function setters(source) {
	const found = new Set();
	const visit = (node) => {
		if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer !== undefined && ts.isCallExpression(node.initializer)) {
			const callee = node.initializer.expression;
			const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
			const setter = node.name.elements[1];
			if (name === "useState" && setter !== undefined && ts.isBindingElement(setter) && ts.isIdentifier(setter.name)) found.add(setter.name.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

/** Calls to `names` in `body` itself, not in a function it creates. */
function directCalls(body, names) {
	const calls = [];
	const visit = (node) => {
		if (ts.isFunctionLike(node)) return;
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text)) calls.push(node);
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(body, visit);
	return calls;
}

/** Where an effect in `source` sets its component's state in its own body: `{ line, effect, setter }`. */
export function effectSets(source) {
	const own = setters(source);
	const found = [];
	if (own.size === 0) return found;
	const visit = (node) => {
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && EFFECTS.has(node.expression.text)) {
			const effect = node.arguments[0];
			if (effect !== undefined && (ts.isArrowFunction(effect) || ts.isFunctionExpression(effect))) {
				for (const call of directCalls(effect.body, own)) found.push({ line: lineOf(source, call), effect: node.expression.text, setter: call.expression.text });
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}
