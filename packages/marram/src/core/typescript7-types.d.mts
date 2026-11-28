// The compiler's types the lints' declarations name, on TypeScript 7.0: its trees from `typescript/unstable/ast`. Its
// checker is named by what readOnce asks of it, which a project's `checker` from `typescript/unstable/sync` has, and
// which readOnce adapts to 5's: importing `Checker` would pull in 7's API declarations, which need `lib: esnext`, into
// every project that imports a lint. The repository's typecheck runs on 5, which has no `typescript/unstable/ast`, so
// it leaves this file out (tsconfig.json): it's checked on 7.0 by declarations.test.mjs, in CI's TypeScript 7 job.
import type { Node } from "typescript/unstable/ast";
export type { Node, SourceFile } from "typescript/unstable/ast";

/** What a checker answers at once: a type or a symbol, with its flags, not a promise of one. */
interface Answer {
	readonly flags: number;
}

/**
 * A checker readOnce can ask: a 7.0 project's `checker` from `typescript/unstable/sync`. One from
 * `typescript/unstable/async` answers with promises, which readOnce can't read, so it isn't one.
 */
export interface TypeChecker {
	getTypeAtLocation(node: Node): Answer | undefined;
	getSymbolAtLocation(node: Node): Answer | undefined;
}
