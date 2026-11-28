// The compiler's types the lints' declarations name, on TypeScript 7.0: its trees from `typescript/unstable/ast`, and
// its checker from `typescript/unstable/sync`, a project's `checker`, which a lint taking one (readOnce) adapts to 5's.
// The repository's typecheck runs on 5, which has neither, so it leaves this file out (tsconfig.json): it's checked on
// 7.0 by declarations.test.mjs, in CI's TypeScript 7 job.
export type { Node, SourceFile } from "typescript/unstable/ast";
export type { Checker as TypeChecker } from "typescript/unstable/sync";
