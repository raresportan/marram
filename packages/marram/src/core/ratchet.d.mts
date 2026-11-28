import type { SourceFile, Node } from "#typescript-types";
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
/** The files under `folder` whose names `match` matches: TypeScript's, declaration files aside, unless it's given. */
export declare function sourceFiles(folder: string, match?: RegExp): string[];
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
/** Where a rule's `find` is: the file's path from the folder (forward slashes), and every file's, to its whole path. */
export interface Where {
	readonly file: string;
	readonly files: ReadonlyMap<string, string>;
}
/** A rule for runRules: a site with its own `key` counts on its own, the rest against the file. */
export interface Rule {
	readonly find: (source: SourceFile, where: Where) => readonly (Site & { readonly key?: string })[];
	readonly owners?: readonly string[];
	readonly allowed: Allowed;
	readonly fix: string;
	readonly stale: Stale;
}
/**
 * Every rule over the files under `root`/`folder`, each file parsed once: the rules' problems, in order. `match` picks
 * the files by name: TypeScript's unless it's given.
 */
export declare function runRules(options: { root: string; folder: string; list: string; rules: readonly Rule[]; match?: RegExp }): string[];
/** Prints the problems and fails once they're written, or prints `ok`. */
export declare function finish(lint: string, problems: readonly string[], ok: string): Promise<void>;
