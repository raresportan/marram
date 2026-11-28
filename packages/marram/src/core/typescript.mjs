// Marram's lints read code through TypeScript's compiler API, written against TypeScript 5's. TypeScript 7, the native
// compiler, which `npm install typescript` gives now, has another JavaScript API, so on 7.0 the lints get 5's API built
// on 7's (./typescript7.mjs). 7.1 changes that API again, so it isn't adapted yet. Every lint loads TypeScript here;
// any other API is named, with what to install instead.
import { createRequire } from "node:module";
import installed from "typescript";

const [major, minor] = String(installed?.version).split(".").map(Number);
const seven = major === 7 && minor === 0;
const ts = seven ? await sevens() : installed;

if (typeof ts?.createSourceFile !== "function" || ts.ScriptKind === undefined) {
	let version = "an unknown version";
	try {
		version = createRequire(import.meta.url)("typescript/package.json").version;
	} catch {
		// Its package.json isn't exported: the version stays unnamed.
	}
	throw new Error(`Marram's lints need TypeScript 5's compiler API (typescript@^5.9.3) or TypeScript 7.0's (typescript@~7.0.2), and this project has typescript ${version}, whose API is different. Install TypeScript 5 beside it: npm install --save-dev typescript@5`);
}

/** TypeScript 7.0's API as 5's, or nothing when this 7.0 doesn't have the API the adapter is built on. */
async function sevens() {
	try {
		return (await import("./typescript7.mjs")).default;
	} catch (error) {
		// Its `typescript/unstable/*` isn't there: the message below says what to install. Any other failure is a bug here.
		if (error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" || error?.code === "ERR_MODULE_NOT_FOUND") return undefined;
		throw error;
	}
}

export default ts;

/**
 * Lets go of `program` once its lint is done. On 5 a program is memory the collector frees; on 7 it's a project the
 * compiler's process holds open, with its snapshot, until it's released.
 */
export const release = seven ? (program) => program.release() : () => {};

/**
 * The checker a lint asks as 5's: on 7, a caller's own checker (a project's `checker` from `typescript/unstable/sync`)
 * is adapted, as the lints' programs' are; on 5, it's 5's already.
 */
export const asChecker = seven ? ts.asChecker : (checker) => checker;

/** A node's children with the tokens between them: 5's `node.getChildren(source)`, which 7's nodes don't have. */
export const children = seven ? ts.getChildren : (node, source) => node.getChildren(source);
