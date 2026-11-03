// The promise lint: a promise is awaited, returned, caught or handed to background; nothing floats.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lintPromises } from "../../src/node/promise-lint.mjs";

const PRELUDE = `
declare function work(): Promise<void>;
declare function background(label: string, work: Promise<unknown>): void;
declare function every(run: () => void): void;
declare const emitter: { on(name: string, listener: () => void): void };
`;

/** The reasons the lint gives for `body`, in a module with `work`, `background`, `every` and `emitter` in scope. */
function lint(body) {
	const root = mkdtempSync(join(tmpdir(), "marram-promises-"));
	try {
		mkdirSync(join(root, "src"));
		writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2023", module: "NodeNext", strict: true, noEmit: true }, include: ["src"] }));
		writeFileSync(join(root, "src", "a.ts"), `${PRELUDE}\nexport async function main() {\n${body}\n}\n`);
		return lintPromises({ root, projects: [{ config: "tsconfig.json", folder: "src" }] }).problems.map((problem) => problem.split(": ")[1]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("a promise dropped, or dropped with void, floats", () => {
	assert.deepEqual(lint(`work();`), ["promise not awaited or caught"]);
	assert.deepEqual(lint(`void work();`), ["`void` doesn't handle a rejection"]);
	assert.deepEqual(lint(`work().finally(() => {});`), ["promise not awaited or caught"]);
});

test("awaited, caught, kept or handed to background, it doesn't", () => {
	for (const body of [`await work();`, `work().catch(() => {});`, `work().then(() => {}, () => {});`, `work().catch(() => {}).finally(() => {});`, `background("x", work());`, `let kept; kept = work();`, `return work();`]) {
		assert.deepEqual(lint(body), [], body);
	}
});

test("an async function passed where its result is dropped floats, written in place or by name", () => {
	assert.deepEqual(lint(`emitter.on("x", async () => { await work(); });`), ["async function passed where its promise is dropped"]);
	assert.deepEqual(lint(`every(work);`), ["async function passed where its promise is dropped"]);
	assert.deepEqual(lint(`every(() => work());`), ["promise returned where it's dropped"]);
	assert.deepEqual(lint(`every(() => background("x", work()));`), []);
});
