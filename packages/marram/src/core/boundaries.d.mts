import type { SourceFile } from "typescript";
import type { Allowed, Site } from "./ratchet.mjs";
/** A layer: the layers its files may import from, and whether they may import Node's modules. */
export interface Layer {
	readonly may?: readonly string[];
	readonly builtins?: boolean;
}
/** A restrict finder for literal module imports and their subpaths, including Node builtin aliases. */
export declare function importsOf(...modules: string[]): (source: SourceFile) => Site[];
/**
 * Problems with the imports under `root`/`folder`, given its `layers` by folder pattern, against the ratchet list
 * `allowed` (`{ "file -> import": reason }`, kept in `list`).
 */
export declare function importBoundaries(options: { root: string; folder: string; layers: Readonly<Record<string, Layer>>; allowed?: Allowed; list: string }): string[];
