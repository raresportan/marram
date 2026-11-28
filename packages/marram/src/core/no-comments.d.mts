import type { SourceFile } from "#typescript-types";
import type { Site } from "./ratchet.mjs";
/** The comments in `source` that aren't allowed, for `restrict`. */
export declare function comments(source: SourceFile): Site[];
