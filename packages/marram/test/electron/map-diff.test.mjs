// The map diff: verification obligations a branch removed from its feature map. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mapCitations } from "../../src/electron/map-citations.mjs";

const BIN = new URL("../../bin/marram.mjs", import.meta.url).pathname;
const MAP = ["- **Counting.** Click the button.", '  - ✅ counts › "It starts at zero"', '  - ✅ counts › "The count survives a restart"', "- **Layout**", "  - ✅ layout", ""].join("\n");

test("map citations pair each ✅ line with its feature, without the name's trailing punctuation", () => {
	assert.deepEqual(mapCitations(MAP.replaceAll("\n", "\r\n")), [
		{ feature: "Counting", citation: 'counts › "It starts at zero"' },
		{ feature: "Counting", citation: 'counts › "The count survives a restart"' },
		{ feature: "Layout", citation: "layout" },
	]);
});

test("map-diff lists obligations removed since the merge base, from a nested project", () => {
	const root = mkdtempSync(join(tmpdir(), "marram-map-diff-"));
	try {
		const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
		const project = join(root, "app");
		mkdirSync(join(project, "docs"), { recursive: true });
		writeFileSync(join(project, "marram.config.mjs"), "export default {};");
		writeFileSync(join(project, "docs/feature-map.md"), MAP);
		git("init", "-q", "-b", "main");
		git("add", ".");
		git("-c", "user.name=test", "-c", "user.email=test@example.org", "commit", "-qm", "map");
		git("checkout", "-qb", "change");
		const diff = () => spawnSync(process.execPath, [BIN, "map-diff", "main", "docs/feature-map.md"], { cwd: project, encoding: "utf8" });
		assert.equal(diff().stdout, "");
		writeFileSync(join(project, "docs/feature-map.md"), MAP.replace('  - ✅ counts › "The count survives a restart"\n', "").replace("- **Counting.**", "- **Counting**"));
		const removed = diff();
		assert.equal(removed.status, 0, removed.stderr);
		assert.equal(removed.stdout, 'Removed verification: Counting — counts › "The count survives a restart"\n');
		rmSync(join(project, "docs/feature-map.md"));
		assert.equal(diff().stdout.split("\n").filter(Boolean).length, 3);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
