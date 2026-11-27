// A pattern a project gives Marram (in marram.config.mjs, or to one of its functions) may have the g or y flag. With
// either, test() and exec() start where the pattern's last match ended, so the second of two texts it should match is
// missed. Dropping those flags isn't right either: sticky means "from the start". So a pattern Marram didn't write is
// matched here, through a copy that keeps its flags and starts at the text's start, as it would the first time.
// scripts/rules.mjs holds Marram's own code to that: test() and exec() elsewhere only on patterns the file writes.

/** Whether `pattern` matches `text`, as it would the first time it's used. */
export const matches = (pattern, text) => new RegExp(pattern.source, pattern.flags).test(text);

/** `pattern`'s match in `text`, as exec gives it the first time it's used, or null. */
export const firstMatch = (pattern, text) => new RegExp(pattern.source, pattern.flags).exec(text);
