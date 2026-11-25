import { readFileSync } from "node:fs";

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
