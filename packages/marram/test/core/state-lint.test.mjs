// The state lint: a function whose callbacks set two or more of its variables keeps a lifecycle nobody wrote down.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { release } from "../../src/core/typescript.mjs";
import { eventStates, programOf } from "../../src/core/state-lint.mjs";

/** What the lint finds in `code`, as a module of its own. */
function found(code) {
	const root = mkdtempSync(join(tmpdir(), "marram-state-lint-"));
	try {
		const file = join(root, "module.mjs");
		writeFileSync(file, code);
		const program = programOf([file]);
		try {
			return eventStates(program.getSourceFile(file), program.getTypeChecker()).map(({ what }) => what);
		} finally {
			release(program);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("flags set from callbacks are found, however a callback reads properties named like them", () => {
	assert.deepEqual(found(`function watch(emitter) {
		let ready = false;
		let closed = false;
		emitter.on("change", (event) => { ready = event.ready; closed = event.closed; });
	}`), ["ready, closed are set by callbacks"]);
	// The supervisor before its table: each flag set from a callback of its own.
	assert.deepEqual(found(`function supervise(child) {
		let timedOut = false;
		let ended;
		setTimeout(() => { timedOut = true; }, 100);
		child.on("exit", (status) => { ended = { status }; });
	}`), ["timedOut, ended are set by callbacks"]);
});

test("a callback's own variables named like the outer ones, one flag, or values that gather, aren't flags", () => {
	assert.deepEqual(found(`function watch(emitter) {
		let ready = false;
		let closed = false;
		emitter.on("change", (ready, closed) => { ready = 1; closed = 2; });
		emitter.on("other", () => { let ready = 3; let closed = 4; ready = 5; closed = 6; });
	}`), []);
	assert.deepEqual(found(`function run(child) {
		let interrupted = false;
		process.on("SIGINT", () => { interrupted = true; });
	}`), []);
	assert.deepEqual(found(`function collect(child) {
		let out = "";
		let saving = Promise.resolve();
		let count = 0;
		let seen = [];
		child.stdout.on("data", (chunk) => { out = out + chunk; saving = saving.then(() => {}); count += 1; seen = [...seen, { chunk, out }]; });
	}`), []);
});

test("a flag read back through a shorthand property still gathers, and one set in the function itself isn't a callback's", () => {
	assert.deepEqual(found(`function f(emitter) {
		let state = {};
		let other = 0;
		emitter.on("x", () => { state = merge({ state }); });
		other = 1;
		emitter.on("y", () => { other = 2; });
	}`), []);
});
