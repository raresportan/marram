// The feature map cites only checks that exist, and every feature says how it's verified. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readFeatureMap } from "../../src/electron/feature-map.ts";

const JOURNEY = `
export async function sidebar(session) {
	await session.check("The sidebar lists documents", async () => true);
	session.check(\`\${theme}: the sidebar fits\`, true);
}
export async function helper(session) {
	session.check("No page errors", true);
}
`;

function read(map, citations) {
	const root = mkdtempSync(join(tmpdir(), "marram-map-"));
	try {
		writeFileSync(join(root, "sidebar.ts"), JOURNEY);
		writeFileSync(join(root, "map.md"), map);
		const journeys = { sidebar: { run: async function sidebar() {} } };
		return readFeatureMap({ map: join(root, "map.md"), folder: root, journeys, citations });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("a citation names a journey, one of its checks (or a helper's), or the project's own kind", () => {
	const map = [
		"- **Documents.** Listed.",
		'  - ✅ sidebar › "The sidebar lists documents"',
		'  - ✅ sidebar › "dark: the sidebar fits"',
		'  - ✅ sidebar › "No page errors"',
		"  - ✅ sidebar",
		"  - ✅ server › real.ts",
		"- **Search.** Not yet.",
		"  - ❌ no journey drives it",
	].join("\n");
	const server = [{ pattern: /^server › (\S+)$/, broken: ([, script]) => (script === "real.ts" ? undefined : `no server script ${script}`) }];
	assert.deepEqual(read(map, server), { broken: [], unmarked: [], features: 2, gaps: 1 });
});

test("a citation of nothing, and a feature with no status, are problems", () => {
	const map = [
		"  - ✅ sidebar",
		"- **Documents.**",
		'  - ✅ sidebar › "The sidebar is purple"',
		"  - ✅ settings",
		"  - ✅ server › gone.ts",
		"- **Search.**",
	].join("\n");
	const server = [{ pattern: /^server › (\S+)$/, broken: ([, script]) => `no server script ${script}` }];
	assert.deepEqual(read(map, server), {
		broken: ["line 1: a status outside any feature", 'line 3: sidebar has no check "The sidebar is purple"', 'line 4: no journey in "settings"', "line 5: no server script gone.ts"],
		unmarked: ["Search."],
		features: 2,
		gaps: 0,
	});
});
