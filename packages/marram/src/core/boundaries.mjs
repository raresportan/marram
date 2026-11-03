// Where code runs decides what it may import. Main-process code imported into a renderer slows the UI, and a feature
// reaching into another's folder ties them together for good, so the import graph is a rule, not a convention.
//
// A project names its layers by folder pattern (`features/*/client`, `*` being one folder). A file may import from its
// own layer and from the layers it lists. It may reach another feature (`features/<name>`) only through an `index.ts`:
// the feature's own, or that of one of its sides, as an app's main process needs its host and its renderer its client,
// and one index for both would pull the host into the renderer. Only a layer with `builtins: true` may import `node:` modules or `electron`. Existing violations go on a
// ratchet list, by `file -> import`.
import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { lineOf, parse, ratchet, sourceFiles } from "./ratchet.mjs";

const posix = (path) => path.split(sep).join("/");

/** A pattern as a test of a path's start, `*` standing for one folder, and what it matched, for telling features apart. */
const matcher = (pattern) => new RegExp(`^(${pattern.split("*").join("[^/]+")})(/|$)`);

/** The layer pattern a path (from the folder) is in, with the folder it matched: the longest match wins. */
function layerOf(path, layers) {
	let found;
	for (const pattern of Object.keys(layers)) {
		const match = matcher(pattern).exec(path);
		if (match !== null && (found === undefined || match[1].length > found.folder.length)) found = { pattern, folder: match[1] };
	}
	return found;
}

/** The feature folder (`features/<name>`) of a path, if it's in one. */
const featureOf = (path) => /^(features\/[^/]+)(\/|$)/.exec(path)?.[1];

/** A feature's way in: its folder's `index.ts`, or the `index.ts` of one of its sides (`host/index.ts`, `client/index.ts`). */
const isEntry = (target, feature) => target === feature || /^features\/[^/]+(\/[^/]+)?\/index(\.tsx?)?$/.test(target);

const isBuiltin = (specifier) => specifier === "electron" || specifier.startsWith("node:");

/** What's wrong with `from` (a path from the folder) importing `specifier`, if anything. */
function problem(from, specifier, layers) {
	const mine = layerOf(from, layers);
	if (isBuiltin(specifier)) return layers[mine?.pattern]?.builtins === true || mine === undefined ? undefined : `${mine.pattern} may not import ${specifier}, which needs a host`;
	if (!specifier.startsWith(".")) return undefined;
	const target = posix(relative(".", resolve(dirname(from), specifier)));
	const theirFeature = featureOf(target);
	if (theirFeature !== undefined && theirFeature !== featureOf(from)) return isEntry(target, theirFeature) ? undefined : `reaches inside ${theirFeature}: import an index.ts`;
	const theirs = layerOf(target, layers);
	if (mine === undefined || theirs === undefined || theirs.pattern === mine.pattern) return undefined;
	return (layers[mine.pattern].may ?? []).includes(theirs.pattern) ? undefined : `${mine.pattern} may not import from ${theirs.pattern}`;
}

/** Import specifiers in `source`, including `export … from` and `import()`, each with its node; types count too. */
function imports(source) {
	const found = [];
	const visit = (node) => {
		const named = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined;
		if (named !== undefined && ts.isStringLiteralLike(named)) found.push(named);
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

/**
 * Problems with the imports under `root`/`folder`, given its `layers` (`{ pattern: { may: [patterns], builtins? } }`),
 * against the ratchet list `allowed` (`{ "file -> import": reason }`, kept in `list`).
 */
export function importBoundaries({ root, folder, layers, allowed = {}, list }) {
	const base = resolve(root, folder);
	const found = sourceFiles(base).flatMap((file) => {
		const source = parse(file);
		const from = posix(relative(base, file));
		return imports(source).flatMap((specifier) => {
			const wrong = problem(from, specifier.text, layers);
			return wrong === undefined ? [] : [{ key: `${from} -> ${specifier.text}`, at: `${folder}/${from}:${lineOf(source, specifier)}`, what: wrong }];
		});
	});
	return ratchet({ list, allowed, found, fix: "move the code to a layer that may have it", stale: "is no longer imported that way" });
}
