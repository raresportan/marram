// Judging a journey, and refusing a stale build. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { failed, judge, staleInput } from "../../src/electron/run.ts";

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
