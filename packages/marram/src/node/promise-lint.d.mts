/** What to do with a floating promise. */
export declare const FIX: string;
/** The floating promises in each project (its tsconfig, and the part of it linted, from `root`); and how many files were linted. */
export declare function lintPromises(options: { root: string; projects: readonly { readonly config: string; readonly folder: string }[] }): { files: number; problems: string[] };
