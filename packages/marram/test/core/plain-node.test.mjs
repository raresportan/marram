// Exercise the published package from an isolated consumer, where workspace UI dependencies cannot resolve.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("the published package has no TypeScript sources: its TypeScript modules run in plain Node and typecheck from their declarations", () => {
	const root = mkdtempSync(join(tmpdir(), "marram-built-"));
	try {
		const pkg = resolve(import.meta.dirname, "../..");
		// What a deleted .ts left from an earlier build: the build clears it, so it isn't published.
		writeFileSync(join(pkg, "src/core/deleted-since.js"), "");
		writeFileSync(join(pkg, "src/core/deleted-since.d.ts"), "");
		const build = spawnable("npm", ["run", "build"]);
		execFileSync(build.file, build.args, { ...build.options, cwd: pkg, stdio: "ignore" });
		const pack = spawnable("npm", ["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", root, "--cache", join(root, ".npm")]);
		const [packed] = JSON.parse(execFileSync(pack.file, pack.args, { ...pack.options, cwd: pkg, encoding: "utf8" }));
		// Node won't strip types from a file under node_modules, so a .ts there can't run.
		assert.deepEqual(packed.files.map(({ path }) => path).filter((path) => /\.[cm]?ts$/.test(path) && !/\.d\.[cm]?ts$/.test(path)), []);
		assert.deepEqual(packed.files.map(({ path }) => path).filter((path) => path.includes("deleted-since")), []);
		const installed = join(root, "node_modules/@raresportan/marram");
		mkdirSync(installed, { recursive: true });
		execFileSync("tar", ["-xf", join(root, packed.filename), "--strip-components=1", "-C", installed]);
		// A declaration naming a .ts beside it names a file that isn't published, which TypeScript before 5.0 can't map
		// to its .d.ts.
		for (const { path } of packed.files.filter(({ path }) => /\.d\.[cm]?ts$/.test(path))) {
			assert.doesNotMatch(readFileSync(join(installed, path), "utf8"), /from ["']\.\.?\/[^"']*\.[cm]?ts["']/, path);
		}
		const { exports } = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
		const compiled = Object.entries(exports).filter(([, target]) => typeof target === "object");
		assert.ok(compiled.length > 0);
		for (const [name, { types, default: file }] of compiled) {
			assert.ok(existsSync(join(installed, types)) && existsSync(join(installed, file)), `${name}: ${types} and ${file} are published`);
		}
		// The ones that need no optional peer (React, Playwright), imported as a project would.
		const plain = ["./core/until", "./node/background", "./node/scope", "./electron/ipc", "./electron/run", "./electron/feature-map", "./electron/geometry", "./electron/frames"];
		writeFileSync(join(root, "package.json"), '{ "type": "module" }');
		writeFileSync(join(root, "use.mjs"), plain.map((name, i) => `import * as m${i} from "@raresportan/marram${name.slice(1)}"; if (!Object.keys(m${i}).length) throw Error("${name}");`).join("\n"));
		const imported = spawnSync(process.execPath, ["use.mjs"], { cwd: root, encoding: "utf8" });
		assert.equal(imported.status, 0, imported.stderr);
		writeFileSync(join(root, "use.ts"), 'import { until } from "@raresportan/marram/core/until";\nimport { background } from "@raresportan/marram/node/background";\nimport { Scope } from "@raresportan/marram/node/scope";\nimport { defineIpc } from "@raresportan/marram/electron/ipc";\nexport const all: unknown[] = [until, background, Scope, defineIpc];\n');
		const types = resolve(pkg, "../../node_modules/@types");
		writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", strict: true, noEmit: true, typeRoots: [types], types: ["node"] }, files: ["use.ts"] }));
		const tsc = spawnSync(process.execPath, [resolve(pkg, "../../node_modules/typescript/bin/tsc"), "-p", root], { cwd: root, encoding: "utf8" });
		assert.equal(tsc.status, 0, tsc.stdout + tsc.stderr);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
