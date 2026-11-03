// What in Node starts something that can outlive the call that makes it: a child process, a file watch, a repeating
// timer, an open file or stream. A project lists the files where these may start, each with the owner that ends it
// (`restrict` from @raresportan/marram/core/ratchet, with `acquisitions` as its finder), so a resource is never acquired in passing
// and freed, or not, by hand. Pair it with a `Scope` (./scope.ts) per kind of owner, and a check that ending the owner
// leaves nothing behind.
import ts from "typescript";
import { lineOf } from "../core/ratchet.mjs";

/** What each module exports that starts something lasting. Sync calls that finish before returning aren't here. */
const ACQUIRERS = {
	"node:child_process": ["spawn", "exec", "execFile", "fork"],
	"child_process": ["spawn", "exec", "execFile", "fork"],
	"node:fs": ["watch", "watchFile", "open", "openSync", "createReadStream", "createWriteStream", "opendir"],
	"fs": ["watch", "watchFile", "open", "openSync", "createReadStream", "createWriteStream", "opendir"],
	"node:fs/promises": ["watch", "open", "opendir"],
	"fs/promises": ["watch", "open", "opendir"],
};
/** Globals that start something lasting. */
const GLOBALS = new Set(["setInterval"]);

/** The import clause of `statement` when it imports values from a module that starts lasting things. */
function acquiringImport(statement) {
	if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return undefined;
	const module = statement.moduleSpecifier.text;
	const clause = statement.importClause;
	return ACQUIRERS[module] === undefined || clause === undefined || clause.isTypeOnly ? undefined : { module, clause };
}

/** What `source` imports that starts something lasting: names bound to an export, and namespaces of a module. */
function imported(source) {
	const named = new Map(); // local name → "module.export"
	const namespaces = new Map(); // local namespace or default name → module
	for (const { module, clause } of source.statements.map(acquiringImport).filter(Boolean)) {
		if (clause.name !== undefined) namespaces.set(clause.name.text, module);
		const bindings = clause.namedBindings;
		if (bindings !== undefined && ts.isNamespaceImport(bindings)) namespaces.set(bindings.name.text, module);
		const elements = bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements : [];
		for (const element of elements.filter((element) => !element.isTypeOnly)) {
			const name = (element.propertyName ?? element.name).text;
			if (ACQUIRERS[module].includes(name)) named.set(element.name.text, `${module}.${name}`);
		}
	}
	return { named, namespaces };
}

/** What `node` starts, if it names an acquirer: `ns.watch`, or a name referenced (not only called: `promisify(execFile)`). */
function acquirer(node, { named, namespaces }) {
	if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text)) {
		const module = namespaces.get(node.expression.text);
		return ACQUIRERS[module].includes(node.name.text) ? `${module}.${node.name.text}` : undefined;
	}
	if (!ts.isIdentifier(node) || isMemberName(node)) return undefined;
	return named.get(node.text) ?? (GLOBALS.has(node.text) ? node.text : undefined);
}

/** Whether `node` names a member (`{ spawn: … }`, `x.spawn`, `spawn() {}`) rather than referring to a binding. */
function isMemberName(node) {
	const parent = node.parent;
	const named =
		ts.isPropertyAssignment(parent) ||
		ts.isPropertyAccessExpression(parent) ||
		ts.isMethodDeclaration(parent) ||
		ts.isPropertyDeclaration(parent) ||
		ts.isPropertySignature(parent) ||
		ts.isMethodSignature(parent) ||
		ts.isGetAccessorDeclaration(parent) ||
		ts.isSetAccessorDeclaration(parent);
	return named && parent.name === node;
}

/** Where `source` starts a lasting resource, for `restrict`; imports themselves and strings or comments don't count. */
export function acquisitions(source) {
	const imports = imported(source);
	const found = [];
	const visit = (node) => {
		if (ts.isImportDeclaration(node)) return;
		const what = acquirer(node, imports);
		if (what !== undefined) found.push({ line: lineOf(source, node), what: `starts ${what}` });
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

