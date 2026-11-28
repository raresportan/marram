// The compiler's types the lints' declarations name, on TypeScript 7.0: its trees from `typescript/unstable/ast`. Its
// checker is named by what readOnce asks of it, which a project's `checker` from `typescript/unstable/sync` has, and
// which readOnce adapts to 5's: importing `Checker` would pull in 7's API declarations, which need `lib: esnext`, into
// every project that imports a lint. The repository's typecheck runs on 5, which has no `typescript/unstable/ast`, so
// it leaves this file out (tsconfig.json): it's checked on 7.0 by declarations.test.mjs, in CI's TypeScript 7 job.
import type { Node } from "typescript/unstable/ast";
export type { Node, SourceFile } from "typescript/unstable/ast";

/** A checker readOnce can ask: a 7.0 project's `checker`. */
export interface TypeChecker {
	getTypeAtLocation(node: Node): object | undefined;
	getSymbolAtLocation(node: Node): object | undefined;
}
