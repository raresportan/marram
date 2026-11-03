// A commit that fixes review findings names, for each one, its mistake class and the rung that now catches it (the
// project's mistake-classes doc, `review.classes` in marram.config.mjs). Without that, review findings only ever produce
// point fixes: nobody sees that a class keeps recurring, or that no rung could have caught it.
//
// Applies to a commit whose subject fixes review findings or gaps. Each top-level bullet (`- `) of its body is one
// finding and needs a line `Class: <a class, joined by / if between two, or new>. Rung: <a rung | none, because …> …`.
// A body with no bullets needs one such line. The classes are the doc's table rows (`| **A**: …`); the rungs are
// `review.rungs`.
// Usage: marram commit-lint <message file>   (the commit-msg hook)
//        marram commit-lint --range <from>..<to>   (each commit in a range)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REVIEW_FIX = /\breview (findings?|gaps?)\b/i;
const RUNGS = ["type", "lint", "architecture", "check", "journey", "unit"];

/** The class names in a mistake-classes doc: each table row that starts with a bold name. */
export function classesIn(doc) {
	return [...doc.matchAll(/^\| \*\*([A-Za-z0-9-]+)\*\*/gm)].map(([, name]) => name);
}

/** What's wrong with a commit message, if anything, given the project's classes and rungs. */
export function problems(message, { classes, rungs = RUNGS }) {
	const lines = message.split("\n").filter((line) => !line.startsWith("#"));
	const subject = lines[0] ?? "";
	if (!REVIEW_FIX.test(subject) || subject.startsWith("Merge ")) return [];
	const one = `(?:${classes.join("|")})`;
	const named = new RegExp(`\\bClass: (?:${one}(?:\\/${one})*|new)\\b[^\\n]*?\\bRung: (?:(?:${rungs.join("|")})\\b|none, because \\S)`);
	const body = lines.slice(1);
	const findings = [];
	for (const line of body) {
		if (line.startsWith("- ")) findings.push([line]);
		else findings.at(-1)?.push(line);
	}
	const example = `\`Class: <${classes[0]}-${classes.at(-1)}>. Rung: <kind> …\``;
	if (findings.length === 0) return named.test(body.join("\n")) ? [] : [`it fixes review findings but names no class and rung: add ${example}`];
	return findings.flatMap((finding) => (named.test(finding.join("\n")) ? [] : [`"${finding[0].slice(2, 72)}" names no class and rung: add ${example}`]));
}

export function lintCommits(root, config, [mode, target]) {
	const doc = config.review.classes;
	const rules = { classes: classesIn(readFileSync(join(root, doc), "utf8")), rungs: config.review.rungs };
	if (rules.classes.length === 0) throw new Error(`${doc} lists no classes: its table rows start with | **<name>**`);
	const messages = mode === "--range"
		? execFileSync("git", ["log", "--format=%H%x00%B%x01", target], { cwd: root, encoding: "utf8" }).split("\x01").filter((entry) => entry.trim() !== "").map((entry) => entry.trim().split("\x00"))
		: mode === undefined ? [] : [["this commit", readFileSync(mode, "utf8")]];
	const found = messages.flatMap(([commit, message]) => problems(message, rules).map((problem) => `${commit.slice(0, 12)}: ${problem}`));
	if (found.length > 0) {
		console.error(`commit-lint: a fix for review findings names each one's class and rung (${doc})\n${found.map((problem) => `  ${problem}`).join("\n")}`);
		process.exit(1);
	}
}
