import type { SourceFile } from "typescript";
/** Where `until` comes from, unless a project says otherwise. */
export declare const WAITS: "@raresportan/marram/core/until";
/** What's wrong with one check's `source`: it can't fail, or it waits or bounds time on its own. `waits` is where `until` comes from. */
export declare function checkProblems(source: SourceFile, waits?: string): string[];
/** Problems in each file of `root`/`folder` whose name `match`es; and how many files there were. */
export declare function lintChecks(options: { root: string; folder: string; match: RegExp; waits?: string }): { files: number; problems: string[] };
