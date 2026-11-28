// Marram's lints read code through TypeScript's compiler API: TypeScript 5's, the peer dependency (^5.9.3).
// TypeScript 7, the native compiler, which `npm install typescript` gives now, has another JavaScript API, and a lint
// on it would fail on the first thing it reads ("Cannot read properties of undefined"). So every lint loads TypeScript
// here, and one that isn't TypeScript 5's API is named, with what to install instead.
import { createRequire } from "node:module";
import ts from "typescript";

if (typeof ts?.createSourceFile !== "function" || ts.ScriptKind === undefined) {
	let version = "an unknown version";
	try {
		version = createRequire(import.meta.url)("typescript/package.json").version;
	} catch {
		// Its package.json isn't exported: the version stays unnamed.
	}
	throw new Error(`Marram's lints need TypeScript 5's compiler API (typescript@^5.9.3), and this project has typescript ${version}, whose API is different. Install TypeScript 5 beside it: npm install --save-dev typescript@5`);
}

export default ts;
