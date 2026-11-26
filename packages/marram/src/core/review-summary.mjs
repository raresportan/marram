import { execFileSync, spawnSync } from "node:child_process";
import { commitsIn, reviewFindings, subjectsOf } from "./commit-lint.mjs";

function githubRepository(root) {
	const remote = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" });
	const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)\/?(?:\.git)?$/.exec(remote.stdout?.trim());
	return match && `https://github.com/${match[1]}`;
}

export function reviewSummary(root, config, args) {
	const subjects = subjectsOf(config);
	let range = "HEAD";
	if (args.length) {
		if (args.length !== 2 || args[0] !== "--since" || !args[1]) throw new Error("Usage: marram review-summary [--since <ref>]");
		const base = execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${args[1]}^{commit}`], { cwd: root, encoding: "utf8" }).trim();
		range = `${base}..HEAD`;
	}

	const repo = githubRepository(root);
	const groups = new Map();
	let findings = 0;
	let missing = 0;
	for (const [hash, message] of commitsIn(root, range)) {
		const ref = repo ? `${repo}/commit/${hash}` : hash.slice(0, 12);
		for (const block of reviewFindings(message, subjects)) {
			const annotation = /\bClass: ([\w-]+(?:\/[\w-]+)*)\b[^\n]*?\bRung: ([\w-]+)\b([^\n]*)/.exec(block.join("\n"));
			if (!annotation) continue;
			const [, classes, rung, detail] = annotation;
			const title = block[0]?.startsWith("- ") ? block[0].slice(2) : message.split("\n", 1)[0];
			findings++;
			if (rung === "none") missing++;
			for (const name of new Set(classes.split("/"))) {
				if (!groups.has(name)) groups.set(name, new Map());
				const rungs = groups.get(name);
				if (!rungs.has(rung)) rungs.set(rung, []);
				rungs.get(rung).push(`    ${title} — ${rung}${detail.trimEnd()} (${ref})`);
			}
		}
	}

	console.log(`${findings} annotated ${findings === 1 ? "finding" : "findings"}, ${missing} without a rung`);
	const rows = [...groups].map(([name, rungs]) => ({ name, rungs, total: [...rungs.values()].reduce((sum, entries) => sum + entries.length, 0) }));
	for (const { name, rungs, total } of rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))) {
		console.log(`\n${name} (${total})`);
		for (const [rung, entries] of rungs) {
			console.log(`  ${rung} (${entries.length})`);
			for (const entry of entries) console.log(entry);
		}
	}
}
