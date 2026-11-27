// A ratchet lint: something is done in one owning place, and anywhere else only when listed with why. A fix written
// as a lint rule stops the bleeding before the cleanup; the list holds what was there already, and only shrinks:
//   - a site not on the list fails, with what to do instead (the rule's `fix`);
//   - an entry with no reason fails: the reason is what a reviewer judges;
//   - an entry that no longer matches (its file is gone, or no longer does it) fails until it's removed, so a cleanup
//     can't leave room for the next site to slip in under an old excuse.
//
// `ratchet` is the list's rules for any kind of site; `restrict` is the common case, sites found per file in a folder;
// `runRules` runs several such rules over a folder, parsing each file once.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

/**
 * Problems with `found` sites (`{ key, at, what }`: the entry that would allow it, where it is, what it does) against
 * the `allowed` list (entries are a reason or `{ count, reason }`, kept in `list`). `stale` says why a listed key no longer matches: a phrase, or a
 * function of the key.
 */
export function ratchet({ list, allowed, found, fix, stale }) {
	const problems = [];
	const counts = new Map();
	const why = typeof stale === "function" ? stale : () => stale;
	for (const site of found) {
		if (Object.hasOwn(allowed, site.key)) counts.set(site.key, (counts.get(site.key) ?? 0) + (site.count ?? 1));
		else problems.push(`${site.at} ${site.what}: ${fix}, or list it in ${list} with why`);
	}
	for (const [key, entry] of Object.entries(allowed)) {
		const counted = entry !== null && typeof entry === "object";
		const reason = counted ? entry.reason : entry;
		if (typeof reason !== "string" || reason.trim() === "") problems.push(`${key} is listed in ${list} without a reason: say why it's safe`);
		const actual = counts.get(key) ?? 0;
		if (actual === 0) problems.push(`${key} ${why(key)}: remove it from ${list}`);
		if (!counted) continue;
		if (!Number.isSafeInteger(entry.count) || entry.count < 1) problems.push(`${key} needs a positive integer count in ${list}`);
		else if (actual > entry.count) problems.push(`${key} has ${actual} matches, allowance ${entry.count}: ${fix}`);
		else if (actual > 0 && actual < entry.count) problems.push(`${key} has ${actual} matches: lower its count from ${entry.count} to ${actual} in ${list}`);
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
		// With forward slashes on every platform, as `allowed` and `owners` name files.
		const key = relative(base, file).split(sep).join("/");
		if (owners.includes(key)) continue;
		const sites = find(parse(file));
		if (sites.length === 0) continue;
		const what = [...new Set(sites.map((site) => site.what))].join(", ");
		found.push({ key, count: sites.length, at: `${folder}/${key}:${sites[0].line}`, what });
	}
	return ratchet({ list, allowed, found, fix, stale: (key) => (existsSync(join(base, key)) ? stale : "is gone") });
}

/**
 * Every rule in `rules` over the files under `root`/`folder`, each file parsed once, its tree let go before the next:
 * a rule is `{ find, owners?, allowed, fix, stale }`, as restrict takes. `find(source, { file, files })` gets the parsed
 * file, its path from the folder (with forward slashes), and every file's (by that path, to its whole path). A file's
 * sites count against it, by its path, as restrict counts them; a site with its own `key` (`${file} ${name}`) counts on
 * its own, against that entry. Each rule's problems come in the order the rules are given.
 */
export function runRules({ root, folder, list, rules }) {
	const base = join(root, folder);
	const paths = sourceFiles(base);
	const files = new Map(paths.map((path) => [relative(base, path).split(sep).join("/"), path]));
	const found = rules.map(() => []);
	for (const [file, path] of files) {
		const source = parse(path);
		rules.forEach((rule, i) => {
			if (rule.owners?.includes(file)) return;
			const sites = rule.find(source, { file, files });
			const own = sites.filter((site) => site.key !== undefined);
			const byFile = sites.filter((site) => site.key === undefined);
			for (const site of own) found[i].push({ key: site.key, at: `${folder}/${file}:${site.line}`, what: site.what });
			if (byFile.length > 0) found[i].push({ key: file, count: byFile.length, at: `${folder}/${file}:${byFile[0].line}`, what: [...new Set(byFile.map((site) => site.what))].join(", ") });
		});
	}
	return rules.flatMap((rule, i) => {
		// A key starts with the file it's in (`file`, `file setter`, `file -> import`): gone with it.
		const there = (key) => [...files.keys()].some((file) => key === file || key.startsWith(`${file} `));
		const stale = typeof rule.stale === "function" ? rule.stale : (key) => (there(key) ? rule.stale : "is gone");
		return ratchet({ list, allowed: rule.allowed, found: found[i], fix: rule.fix, stale });
	});
}

/** Prints the problems and fails, or prints `ok`. */
export function finish(lint, problems, ok) {
	if (problems.length > 0) {
		console.error(`${lint}: ${problems.length} problem(s)\n${problems.map((problem) => `  ✗ ${problem}`).join("\n")}`);
		process.exit(1);
	}
	console.log(`ok: ${ok}`);
}
