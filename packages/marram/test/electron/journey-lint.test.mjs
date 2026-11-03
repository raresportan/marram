// The journey lint: a check reads the app through a function it polls, and a polled check is awaited.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lintJourneys } from "../../src/electron/journey-lint.mjs";

const SESSION = `
export interface Session {
	check(label: string, ok: boolean, detail?: string): void;
	check(label: string, ok: () => boolean | Promise<boolean>, detail?: () => string | undefined): Promise<void>;
}
declare const page: { count(): Promise<number> };
`;

/** The problems in one journey whose body is `body`, with a `session` and a `page` in scope. */
function lint(body) {
	const root = mkdtempSync(join(tmpdir(), "marram-journeys-"));
	try {
		mkdirSync(join(root, "verify"));
		writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2023", module: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true } }));
		writeFileSync(join(root, "verify", "a-journey.ts"), `${SESSION}\nexport async function journey(session: Session) {\n${body}\n}\n`);
		return lintJourneys({ root, folder: "verify", tsconfig: "tsconfig.json" }).problems.map((problem) => problem.replace(/^.*?: line \d+: /, ""));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("a check that awaits inside a plain boolean reads once", () => {
	assert.deepEqual(lint(`session.check("one", (await page.count()) === 1);`), ["reads once, inside the check: pass a function, which the check polls until it holds"]);
	assert.deepEqual(lint(`const n = await page.count(); session.check("one", n === 1);`), []);
	assert.deepEqual(lint(`await session.check("one", async () => (await page.count()) === 1);`), []);
});

test("a polled check is awaited, whether its function is written in place or named", () => {
	const unawaited = "a polled check nobody awaits: the journey goes on, and may end, before it's recorded";
	assert.deepEqual(lint(`session.check("one", async () => (await page.count()) === 1);`), [unawaited]);
	assert.deepEqual(lint(`const one = async () => (await page.count()) === 1; session.check("one", one); session.check("control", true);`), [unawaited]);
	assert.deepEqual(lint(`const one = async () => (await page.count()) === 1; await session.check("one", one);`), []);
});

test("a polled check reads its details on failure, not before", () => {
	assert.deepEqual(lint(`await session.check("one", async () => (await page.count()) === 1, \`saw \${await page.count()}\`);`), ["reads its details before the check polls: pass them as a function, read on failure"]);
	assert.deepEqual(lint(`await session.check("one", async () => (await page.count()) === 1, () => "saw");`), []);
});
