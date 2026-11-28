// The compiler's types the lints' declarations name, from TypeScript 5's API. On TypeScript 7.0, the package's
// `#typescript-types` import resolves to ./typescript7-types.d.mts instead (package.json, `types@>=7.0`).
export type { Node, SourceFile, TypeChecker } from "typescript";
