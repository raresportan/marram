import { readFileSync } from "node:fs";

/** The last lines of a command's `output` worth showing: not blank, not a stack frame, not npm's report that its command failed. */
const NOISE = /^\s*$|^\s+at |^Node\.js v|^npm (error|ERR!)/;
export const outputExcerpt = (output) => output.split("\n").filter((line) => !NOISE.test(line)).slice(-3).map((line) => line.trim()).join(" ⏎ ") || "(no output)";

export function failureExcerpt(log) {
	// From the first failure line when there is one (a test runner's "not ok", a check's ✗), else the end of the log.
	try {
		const lines = readFileSync(log, "utf8").trimEnd().split("\n");
		const first = lines.findIndex((line) => /^\s*(not ok|✗)/.test(line));
		return (first === -1 ? lines.slice(-60) : lines.slice(first, first + 60)).join("\n");
	} catch {
		return "";
	}
}
