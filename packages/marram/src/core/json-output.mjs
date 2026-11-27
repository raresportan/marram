// `--json` on a command (gate, probe, guard-diff, review-summary): its result as one JSON document on stdout, for CI to
// read, and what it says as it goes on stderr instead, so the two don't mix.

/** `args` without `--json`, whether it was there, and where the command's lines go: stdout, or stderr with `--json`. */
export function jsonOption(args) {
	const json = args.includes("--json");
	return { json, args: args.filter((arg) => arg !== "--json"), say: json ? (...lines) => console.error(...lines) : (...lines) => console.log(...lines) };
}

/** Print `result` as the command's JSON document. */
export const printJson = (result) => process.stdout.write(JSON.stringify(result, null, 2) + "\n");
