import type { SourceFile } from "typescript";
/** Where an effect in `source` sets its component's state in its own body. */
export declare function effectSets(source: SourceFile): { line: number; effect: string; setter: string }[];
