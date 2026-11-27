// A commit that fixes review findings names, for each one, its mistake class and the rung that now catches it (the
// project's mistake-classes doc, `review.classes` in marram.config.mjs). Without that, review findings only ever produce
// point fixes: nobody sees that a class keeps recurring, or that no rung could have caught it.
//
// Applies to a commit whose subject fixes review findings: one that names review findings, gaps, comments, feedback,
// notes, nits or suggestions (also PR or pull request ones), or that addresses, applies, resolves or handles review or
// feedback. A project with its own wording sets `review.subjects` to a pattern. Each top-level bullet (`- `) of its body is one
// finding and needs a line `Class: <a class, joined by / if between two, or new>. Rung: <a rung | none, because …> …`.
// A body with no bullets needs one such line. The classes are the doc's table rows (`| **A**: …`); the rungs are
// `review.rungs`.
// Usage: marram commit-lint <message file>   (the commit-msg hook)
//        marram commit-lint --range <from>..<to>   (each commit in a range)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matches } from "./pattern.mjs";

const REVIEW_FIX = /\b(?:(?:code )?review|PR|pull request)(?:'s)? (?:findings?|gaps?|comments|feedback|notes|nits|suggestions)\b|\b(?:address(?:es|ed|ing)?|appl(?:y|ies|ied|ying)|resolv(?:e[sd]?|ing)|handl(?:e[sd]?|ing)) (?:the |all )?(?:review|feedback|nits)\b/i;
const RUNGS = ["type", "lint", "architecture", "check", "journey", "unit"];

/** The class names in a mistake-classes doc: each table row that starts with a bold name. */
export function classesIn(doc) {
	return [...doc.matchAll(/^\| \*\*([A-Za-z0-9-]+)\*\*/gm)].map(([, name]) => name);
}

/** The pattern a review fix's subject matches: the project's `review.subjects`, if it sets one. */
export function subjectsOf(config) {
	const subjects = config.review?.subjects;
	if (subjects === undefined) return REVIEW_FIX;
	if (!(subjects instanceof RegExp)) throw new Error("review.subjects in marram.config.mjs is a RegExp, the subjects of review-fix commits");
	return subjects;
}

/** The finding blocks of a review-fix commit, using its whole body when there are no bullets. */
export function reviewFindings(message, subjects = REVIEW_FIX) {
	const lines = message.split("\n").filter((line) => !line.startsWith("#"));
	const subject = lines[0] ?? "";
	if (!matches(subjects, subject) || subject.startsWith("Merge ")) return [];
	const body = lines.slice(1);
	const findings = [];
	for (const line of body) {
		if (line.startsWith("- ")) findings.push([line]);
		else findings.at(-1)?.push(line);
	}
	return findings.length ? findings : [body];
}

/** Git log's NUL-separated commit hashes and messages, newest first. */
export function commitsIn(root, range) {
	const fields = execFileSync("git", ["log", "-z", "--format=%H%x00%B", "--end-of-options", range, "--"], {
		cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
	}).split("\0");
	const commits = [];
	for (let i = 0; i + 1 < fields.length; i += 2) commits.push([fields[i], fields[i + 1]]);
	return commits;
}

/** What's wrong with a commit message, if anything, given the project's classes and rungs. */
export function problems(message, { classes, rungs = RUNGS, subjects }) {
	const findings = reviewFindings(message, subjects);
	const one = `(?:${classes.join("|")})`;
	const named = new RegExp(`\\bClass: (?:${one}(?:\\/${one})*|new)\\b[^\\n]*?\\bRung: (?:(?:${rungs.join("|")})\\b|none, because \\S)`);
	const example = `\`Class: <${classes[0]}-${classes.at(-1)}>. Rung: <kind> …\``;
	return findings.flatMap((finding) => {
		if (named.test(finding.join("\n"))) return [];
		const label = finding[0]?.startsWith("- ") ? `"${finding[0].slice(2, 72)}"` : "it fixes review findings but";
		return [`${label} names no class and rung: add ${example}`];
	});
}

export function lintCommits(root, config, [mode, target]) {
	const doc = config.review.classes;
	const rules = { classes: classesIn(readFileSync(join(root, doc), "utf8")), rungs: config.review.rungs, subjects: subjectsOf(config) };
	if (rules.classes.length === 0) throw new Error(`${doc} lists no classes: its table rows start with | **<name>**`);
	const messages = mode === "--range"
		? commitsIn(root, target)
		: mode === undefined ? [] : [["this commit", readFileSync(mode, "utf8")]];
	const found = messages.flatMap(([commit, message]) => problems(message, rules).map((problem) => `${commit.slice(0, 12)}: ${problem}`));
	if (found.length > 0) {
		console.error(`commit-lint: a fix for review findings names each one's class and rung (${doc})\n${found.map((problem) => `  ${problem}`).join("\n")}`);
		process.exit(1);
	}
}
