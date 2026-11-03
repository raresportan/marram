// A ratchet lint: something is done in one owning place, and anywhere else only when listed with why. A fix written
// as a lint rule stops the bleeding before the cleanup; the list holds what was there already, and only shrinks:
//   - a site not on the list fails, with what to do instead (the rule's `fix`);
//   - an entry with no reason fails: the reason is what a reviewer judges;
//   - an entry that no longer matches (its file is gone, or no longer does it) fails until it's removed, so a cleanup
//     can't leave room for the next site to slip in under an old excuse.
//
// `ratchet` is the list's rules for any kind of site; `restrict` is the common case, sites found per file in a folder.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/**
 * Problems with `found` sites (`{ key, at, what }`: the entry that would allow it, where it is, what it does) against
 * the `allowed` list (`{ key: reason }`, kept in `list`). `stale` says why a listed key no longer matches: a phrase, or a
 * function of the key.
 */
export function ratchet({ list, allowed, found, fix, stale }) {
	const problems = [];
	const seen = new Set();
	const why = typeof stale === "function" ? stale : () => stale;
	for (const site of found) {
		if (Object.hasOwn(allowed, site.key)) seen.add(site.key);
		else problems.push(`${site.at} ${site.what}: ${fix}, or list it in ${list} with why`);
	}
	for (const [key, reason] of Object.entries(allowed)) {
		if (typeof reason !== "string" || reason.trim() === "") problems.push(`${key} is listed in ${list} without a reason: say why it's safe`);
		if (!seen.has(key)) problems.push(`${key} ${why(key)}: remove it from ${list}`);
	}
	return problems;
}

/** The TypeScript files under `folder`, declaration files aside. */
export function sourceFiles(folder) {
	return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
		const path = join(folder, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
	});
}

export const parse = (file) => ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

export const lineOf = (source, node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

/**
 * The ratchet over each file under `root`/`folder`: `find(source)` returns the file's sites (`{ line, what }`), and a
 * file with any is allowed only when `allowed` lists it (by path from the folder), or it's one of `owners`, where the
 * thing is meant to be done. `stale` says what a listed file no longer does.
 */
export function restrict({ root, folder, owners = [], find, allowed, list, fix, stale }) {
	const base = join(root, folder);
	const found = [];
	for (const file of sourceFiles(base)) {
		const key = relative(base, file);
		if (owners.includes(key)) continue;
		const sites = find(parse(file));
		if (sites.length === 0) continue;
		const what = [...new Set(sites.map((site) => site.what))].join(", ");
		found.push({ key, at: `${folder}/${key}:${sites[0].line}`, what });
	}
	return ratchet({ list, allowed, found, fix, stale: (key) => (existsSync(join(base, key)) ? stale : "is gone") });
}

/** Prints the problems and fails, or prints `ok`. */
export function finish(lint, problems, ok) {
	if (problems.length > 0) {
		console.error(`${lint}: ${problems.length} problem(s)\n${problems.map((problem) => `  ✗ ${problem}`).join("\n")}`);
		process.exit(1);
	}
	console.log(`ok: ${ok}`);
}
