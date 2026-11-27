// `--json` on a command (gate, probe, guard-diff, review-summary): its result as one JSON document on stdout, for CI to
// read, and what it says as it goes on stderr instead, so the two don't mix.

/** `args` without `--json`, whether it was there, and where the command's lines go: stdout, or stderr with `--json`. */
export function jsonOption(args) {
	const json = args.includes("--json");
	return { json, args: args.filter((arg) => arg !== "--json"), say: json ? (...lines) => console.error(...lines) : (...lines) => console.log(...lines) };
}

/**
 * Print `result` as the command's JSON document: settled once it's all written. To a pipe, a write that doesn't fit
 * finishes later (on macOS), so a command that exits next waits for it, or its reader gets the document cut short.
 */
export const printJson = (result) => new Promise((done, fail) => process.stdout.write(JSON.stringify(result, null, 2) + "\n", (error) => (error ? fail(error) : done())));

/**
 * Exit with `code` once what the command wrote to stdout and stderr is all written: to a pipe, a write that doesn't fit
 * finishes later (on macOS), and exiting first cuts the output short. Never settles, so a caller that awaits it stops.
 */
export const exitWhenWritten = (code) => new Promise(() => process.stdout.write("", () => process.stderr.write("", () => process.exit(code))));
