// The compiler's types the lints' declarations name, on TypeScript 7.0, whose trees are in `typescript/unstable/ast`.
// Its checker isn't 5's: the lints take the checker typescript7.mjs builds, which answers as 5's does.
import type { Node, SourceFile } from "typescript/unstable/ast";
export type { Node, SourceFile };

/** A type, as the adapter's checker gives it: 5's methods, on 7's type. */
export interface Type {
	readonly flags: number;
	isUnion(): boolean;
	readonly types: readonly Type[];
	getProperty(name: string): unknown;
	getCallSignatures(): readonly unknown[];
}

/** The checker typescript7.mjs gives a program: as much of 5's TypeChecker as the lints use. */
export interface TypeChecker {
	getSymbolAtLocation(node: Node): unknown;
	getShorthandAssignmentValueSymbol(node: Node): unknown;
	getExportsOfModule(symbol: unknown): readonly unknown[];
	getAliasedSymbol(symbol: unknown): unknown;
	getTypeAtLocation(node: Node): Type;
	getContextualType(node: Node): Type | undefined;
	getReturnTypeOfSignature(signature: unknown): Type;
}
