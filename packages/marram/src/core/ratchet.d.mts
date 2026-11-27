import type { SourceFile, Node } from "typescript";
/** Where a file does the thing a ratchet restricts: its line, and what it does there. */
export interface Site {
	readonly line: number;
	readonly what: string;
}
/** A site any ratchet judges: the list entry that would allow it, where it is, what it does, and how many it counts for. */
export interface Found {
	readonly key: string;
	readonly at: string;
	readonly what: string;
	readonly count?: number;
}
/** A ratchet list: each entry is a reason, or a reason with how many sites it allows. */
export type Allowed = Readonly<Record<string, string | { readonly count: number; readonly reason: string }>>;
/** Why a listed key no longer matches: a phrase, or a function of the key. */
export type Stale = string | ((key: string) => string);
/**
 * Problems with `found` sites against the `allowed` list (kept in `list`). `stale` says why a listed key no longer
 * matches.
 */
export declare function ratchet(options: { list: string; allowed: Allowed; found: readonly Found[]; fix: string; stale: Stale }): string[];
/** The TypeScript files under `folder`, declaration files aside. */
export declare function sourceFiles(folder: string): string[];
export declare const parse: (file: string) => SourceFile;
export declare const lineOf: (source: SourceFile, node: Node) => number;
/**
 * The ratchet over each file under `root`/`folder`: `find(source)` returns the file's sites, and a file with any is
 * allowed only when `allowed` lists it (by path from the folder), or it's one of `owners`.
 */
export declare function restrict(options: {
	root: string;
	folder: string;
	owners?: readonly string[];
	find: (source: SourceFile) => readonly Site[];
	allowed: Allowed;
	list: string;
	fix: string;
	stale: string;
}): string[];
/** Prints the problems and fails, or prints `ok`. */
export declare function finish(lint: string, problems: readonly string[], ok: string): void;
