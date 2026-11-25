import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { mapCitations } from "./map-citations.mjs";

export function mapDiff(root, _config, args) {
	if (args.length !== 2) throw new Error("Usage: marram map-diff <base> <map relative to project>");
	const [base, path] = args;
	const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trimEnd();
	const commit = git("rev-parse", "--verify", "--end-of-options", base + "^{commit}");
	const ancestor = git("merge-base", commit, "HEAD");
	const file = resolve(root, path);
	const repoPath = relative(git("rev-parse", "--show-toplevel"), file).split(sep).join("/");
	const object = ancestor + ":" + repoPath;
	const before = git("ls-tree", "--full-tree", ancestor, "--", ":(top,literal)" + repoPath) ? git("show", object) : "";
	const current = new Set(mapCitations(existsSync(file) ? readFileSync(file, "utf8") : "").map((entry) => JSON.stringify(entry)));
	for (const entry of mapCitations(before)) {
		if (!current.has(JSON.stringify(entry))) console.log(`Removed verification: ${entry.feature} — ${entry.citation}`);
	}
}
