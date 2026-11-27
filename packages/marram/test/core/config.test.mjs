// A project's marram.config.mjs is checked when it's loaded, all of it. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { problems } from "../../src/core/config.mjs";

const BIN = fileURLToPath(new URL("../../bin/marram.mjs", import.meta.url));
const REPO = resolve(import.meta.dirname, "../../../..");
const stage = (name) => ({ name, run: ["npm", "test"] });

test("Marram's own config and Tally's have no problems, and neither has an empty one", async () => {
	for (const file of ["marram.config.mjs", "examples/tally/marram.config.mjs"]) {
		assert.deepEqual(problems((await import(pathToFileURL(join(REPO, file)).href)).default), [], file);
	}
	assert.deepEqual(problems({}), []);
});

test("a misspelled key is named, with the key it's likely meant to be", () => {
	assert.deepEqual(problems({ gat: {} }), ["gat isn't something Marram reads: did you mean gate?"]);
	assert.deepEqual(problems({ gate: { tiers: { defualt: [stage("unit")] } } }), ["gate.tiers.defualt isn't something Marram reads: did you mean gate.tiers.default?"]);
	assert.deepEqual(problems({ gate: { tiers: { fast: [{ ...stage("unit"), evn: {} }] } } }), ["gate.tiers.fast[0].evn isn't something Marram reads: did you mean gate.tiers.fast[0].env?"]);
	assert.deepEqual(problems({ review: { classes: "docs/m.md", subjcts: /x/ } }), ["review.subjcts isn't something Marram reads: did you mean review.subjects?"]);
	assert.deepEqual(problems({ build: {} }), ["build isn't something Marram reads (it reads gate, probes, replay, review)"]);
});

test("a value of the wrong kind is named, wherever it is", () => {
	assert.deepEqual(problems(null), ["its default export must be an object: { gate, probes, replay, review }"]);
	const found = problems({
		gate: {
			logs: "",
			keep: 0,
			progress: "✓",
			sleepGapMs: -1,
			prePush: "fast",
			tiers: { fast: [{ name: "a/b", run: "npm test" }, { name: "x", run: ["a"], env: { TOKEN: 1 } }, stage("x")], full: "all" },
		},
		review: { rungs: [] },
		replay: { timeoutMs: Infinity },
	});
	assert.deepEqual(found, [
		"gate.logs must be a folder in the project",
		"gate.keep must be how many runs to keep logs for: a whole number above 0, or Infinity",
		"gate.progress must be a RegExp",
		"gate.sleepGapMs must be a positive number of milliseconds",
		'gate.prePush is "fast": a push can require the default gate or the full one ("default" or "full")',
		"gate.tiers.fast[0].name must be a name, without / or \\: its log is <name>.log",
		'gate.tiers.fast[0].run must be a command and its arguments, as in ["npm", "test"]',
		"gate.tiers.fast[1].env must be an object of environment variables, each a string",
		'gate.tiers.fast[2]: another stage in fast is named "x", and each has its own log',
		"gate.tiers.full must be a list of stages",
		"replay.timeoutMs in marram.config.mjs must be a positive number of milliseconds",
		"review.classes must be the path of the mistake-classes doc",
		"review.rungs must be a list of rung names",
	]);
	assert.deepEqual(problems({ gate: { keep: Infinity, tiers: {} } }), []);
	assert.deepEqual(problems({ gate: { keep: 2.5, tiers: {} } }), ["gate.keep must be how many runs to keep logs for: a whole number above 0, or Infinity"]);
	assert.deepEqual(problems({ gate: { env: "CI", tiers: {} } }), ['gate.env must be a list of environment variable names, as in ["CI", "NODE_ENV"]']);
	assert.deepEqual(problems({ gate: { env: ["CI", "NODE_ENV"], tiers: {} } }), []);
});

test("probes are checked as probe checks them, and a fault's keys too", () => {
	assert.deepEqual(problems({ probes: { faults: [{ name: "f", patch: "p.patch", run: ["npm", "test"], expect: /x/, cwdd: "app" }] } }), [
		"probes.faults[0].cwdd isn't something Marram reads: did you mean probes.faults[0].cwd?",
	]);
	assert.deepEqual(problems({ probes: { link: "node_modules", faults: [] } }), ["probes.link must be a list of paths", "marram.config.mjs has no probes.faults"]);
	assert.deepEqual(problems({ probes: { faults: [{ name: "f", patch: "p.patch", test: { file: "a.test.mjs", name: "t", assertion: "a", nme: "x" } }] } }), [
		"probes.faults[0].test.nme isn't something Marram reads: did you mean probes.faults[0].test.name?",
	]);
});

test("a fault is checked one way, with nothing of the other way, and faults without names aren't taken for each other", () => {
	const either = (i) => `probes.faults[${i}] ("f${i}") needs either run and expect, or test: { file, name, assertion }`;
	const named = { file: "a.test.mjs", name: "t", assertion: "a" };
	assert.deepEqual(problems({ probes: { faults: [
		{ name: "f0", patch: "p.patch", run: ["npm", "test"], expect: /x/, test: {} },
		{ name: "f1", patch: "p.patch", test: named, run: ["npm", "test"] },
		{ name: "f2", patch: "p.patch", test: named, expect: "x" },
	] } }), [either(0), either(1), either(2)]);
	assert.deepEqual(problems({ probes: { faults: [{ patch: "p.patch", test: named }, { patch: "p.patch", test: named }] } }), [
		"probes.faults[0] needs a name",
		"probes.faults[1] needs a name",
	]);
});

test("every command refuses a config with problems, and lists them all before it does anything", () => {
	const root = mkdtempSync(join(tmpdir(), "marram-config-"));
	try {
		writeFileSync(join(root, "marram.config.mjs"), 'export default { gate: { tiers: { defualt: [] }, keep: -1 }, reveiw: {} };');
		for (const args of [["gate"], ["commit-lint"], ["hook", "pre-push"]]) {
			const result = spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: "utf8" });
			assert.notEqual(result.status, 0, args.join(" "));
			assert.match(result.stderr, /marram\.config\.mjs isn't what Marram reads:\n {2}reveiw isn't something Marram reads: did you mean review\?\n {2}gate\.keep must be .*\n {2}gate\.tiers\.defualt isn't something Marram reads: did you mean gate\.tiers\.default\?/, args.join(" "));
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
