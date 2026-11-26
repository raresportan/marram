// Exercise the published package from an isolated consumer, where workspace UI dependencies cannot resolve.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { spawnable } from "../../src/core/command.mjs";

test("a plain Node CLI verifies a feature with only Marram installed", () => {
	const root = mkdtempSync(join(tmpdir(), "marram-cli-"));
	try {
		const pkg = resolve(import.meta.dirname, "../..");
		const pack = spawnable("npm", ["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", root, "--cache", join(root, ".npm")]);
		const [packed] = JSON.parse(execFileSync(pack.file, pack.args, { ...pack.options, cwd: pkg, encoding: "utf8" }));
		const installed = join(root, "node_modules/@raresportan/marram");
		mkdirSync(installed, { recursive: true });
		execFileSync("tar", ["-xf", join(root, packed.filename), "--strip-components=1", "-C", installed]);
		writeFileSync(join(root, ".gitignore"), "node_modules/\n.verify/\n.npm/\n*.tgz\n");
		execFileSync("git", ["init", "-q"], { cwd: root });
		writeFileSync(join(root, "marram.config.mjs"), 'export default {gate:{logs:".verify",tiers:{full:[{name:"cli",run:["node","verify.mjs"]}]}}};');
		writeFileSync(join(root, "map.md"), '- **Greeting**\n  - ✅ greet › "prints greeting"\n');
		writeFileSync(join(root, "cli.mjs"), 'console.log("hello");');
		writeFileSync(join(root, "verify.mjs"), `
import { execFileSync } from "node:child_process";
import { runJourneys } from "@raresportan/marram/core/run";
import { readFeatureMap } from "@raresportan/marram/core/feature-map";
async function greet(session) {
	const actual = execFileSync(process.execPath, ["cli.mjs"], { encoding: "utf8" }).trim();
	session.check("prints greeting", actual === "hello");
}
const map = readFeatureMap({ map: "map.md", folder: ".", journeys: { greet: { run: greet } } });
if (map.broken.length || map.unmarked.length) throw Error(JSON.stringify(map));
const passed = await runJourneys({
	chosen: ["greet"], evidence: ".verify/evidence", featureMap: { path: "map.md" },
	open: () => ({ checks: [], check(label, ok) { this.checks.push({ label, ok }); } }),
	run: (_, session) => greet(session),
});
process.exitCode = passed ? 0 : 1;
`);
		const gate = () => spawnSync(process.execPath, [join(installed, "bin/marram.mjs"), "gate", "full"], { cwd: root, encoding: "utf8" });
		const clean = gate();
		assert.equal(clean.status, 0, clean.stdout + clean.stderr);
		writeFileSync(join(root, "cli.mjs"), 'console.log("goodbye");');
		assert.equal(gate().status, 1);
		const [journey] = JSON.parse(readFileSync(join(root, ".verify/evidence/report.json")));
		assert.deepEqual(journey.checks, [{ label: "prints greeting", ok: false }]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
