// Judging a journey, and refusing a stale build. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { failed, judge, runJourneys, staleInput } from "../../src/electron/run.ts";

const session = ({ checks = [{ label: "x", ok: true }], unsettled = [], pageErrors = [] } = {}) => ({ checks, unsettled: new Set(unsettled), pageErrors });

test("a journey fails on a failed check, an error, a page error, an unawaited check, or checking nothing", () => {
	assert.equal(failed(judge("j", session(), undefined)), false);
	assert.equal(failed(judge("j", session({ checks: [{ label: "x", ok: false }] }), undefined)), true);
	assert.equal(failed(judge("j", session(), "boom")), true);
	assert.equal(failed(judge("j", session({ pageErrors: ["TypeError"] }), undefined)), true);
	assert.equal(judge("j", session({ unsettled: ["polled"] }), undefined).error, "ended with checks nobody awaited: polled");
	assert.equal(judge("j", session({ checks: [] }), undefined).error, "checked nothing");
	assert.equal(judge("j", session({ checks: [] }), "boom").error, "boom");
});

test("a build is stale when any of its inputs is newer than its oldest output, or an output is missing", () => {
	const root = mkdtempSync(join(tmpdir(), "marram-stale-"));
	try {
		mkdirSync(join(root, "src", "deep"), { recursive: true });
		const at = (file, seconds) => { writeFileSync(join(root, file), "x"); utimesSync(join(root, file), seconds, seconds); };
		at("src/deep/a.ts", 100);
		at("config.ts", 100);
		at("out-1.js", 200);
		at("out-2.js", 300);
		const build = { outputs: [join(root, "out-1.js"), join(root, "out-2.js")], inputs: [join(root, "src"), join(root, "config.ts")] };
		assert.equal(staleInput(root, [build]), undefined);
		at("src/deep/a.ts", 250);
		assert.equal(staleInput(root, [build]), join("src", "deep", "a.ts"));
		at("src/deep/a.ts", 100);
		at("config.ts", 250);
		assert.equal(staleInput(root, [build]), "config.ts");
		assert.equal(staleInput(root, [{ outputs: [join(root, "missing.js")], inputs: [join(root, "src")] }]), join("src", "deep", "a.ts"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a full run requires the cited restart check even when the other checks pass", async () => {
	const evidence = mkdtempSync(join(tmpdir(), "marram-observations-"));
	try {
		const path = join(evidence, "map.md");
		writeFileSync(path, '- **Counting**\n  - ✅ counts › "survives restart"');
		const checkRestart = (s) => s.checks.push({ label: "survives restart", ok: true });
		const options = {
			chosen: ["counts"], evidence, featureMap: { path },
			open: () => ({ ...session(), dispose: async () => {} }),
			run: async () => {},
		};
		assert.equal(await runJourneys(options), false);
		assert.match(readFileSync(join(evidence, "missing-citations.json"), "utf8"), /survives restart/);
		assert.equal(await runJourneys({ ...options, run: async (_, s) => checkRestart(s) }), true);
	} finally {
		rmSync(evidence, { recursive: true, force: true });
	}
});

test("a journey that throws doesn't stop the run when its session's shot isn't async", async () => {
	const evidence = mkdtempSync(join(tmpdir(), "marram-shot-"));
	try {
		const ran = [];
		const passed = await runJourneys({
			chosen: ["throws", "after"], evidence,
			open: () => ({ ...session(), shot() {}, dispose: async () => {} }),
			run: async (journey) => {
				ran.push(journey);
				if (journey === "throws") throw new Error("boom");
			},
		});
		assert.equal(passed, false);
		assert.deepEqual(ran, ["throws", "after"]);
		assert.deepEqual(JSON.parse(readFileSync(join(evidence, "report.json"), "utf8")).map((row) => row.error), ["boom", undefined]);
	} finally {
		rmSync(evidence, { recursive: true, force: true });
	}
});
