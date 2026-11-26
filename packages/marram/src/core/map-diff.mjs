import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoPath } from "./checkout.mjs";
import { mapCitations } from "./map-citations.mjs";

export function mapDiff(root, _config, args) {
	if (args.length !== 2) throw new Error("Usage: marram map-diff <base> <map relative to project>");
	const [base, path] = args;
	const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trimEnd();
	const ancestor = git("merge-base", git("rev-parse", "--verify", "--end-of-options", base + "^{commit}"), "HEAD");
	for (const entry of removedCitations(root, ancestor, path)) console.log(`Removed verification: ${entry.feature} — ${entry.citation}`);
}

/** The citations in the map at `path` (from the project root) at `ancestor` that the working tree's map no longer has. */
export function removedCitations(root, ancestor, path) {
	const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trimEnd();
	const file = resolve(root, path);
	const named = repoPath(root, path);
	const before = git("ls-tree", "--full-tree", ancestor, "--", ":(top,literal)" + named) ? git("show", ancestor + ":" + named) : "";
	const current = new Set(mapCitations(existsSync(file) ? readFileSync(file, "utf8") : "").map((entry) => JSON.stringify(entry)));
	return mapCitations(before).filter((entry) => !current.has(JSON.stringify(entry)));
}
