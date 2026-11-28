import type { SourceFile, TypeChecker } from "#typescript-types";
/** The checks in `source` (calls `<session>.check(label, ok, detail?)`) that read once, or whose polling nobody waits for. */
export declare function readOnce(source: SourceFile, checker: TypeChecker, session?: string): string[];
/** Problems in the journeys (`.ts` files) of `root`/`folder`, type-checked with `tsconfig`'s options; and how many there were. */
export declare function lintJourneys(options: { root: string; folder: string; tsconfig: string; session?: string }): { files: number; problems: string[] };
