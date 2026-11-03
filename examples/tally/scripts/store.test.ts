// The count survives what a file can do to it. Run: npm test -w tally
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CounterStore } from "../src/features/counter/host/store.ts";

function inScratch(run: (file: string) => Promise<void>): () => Promise<void> {
	return async () => {
		const folder = mkdtempSync(join(tmpdir(), "tally-store-"));
		try {
			await run(join(folder, "count.json"));
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
	};
}

test("a missing or damaged file counts as zero", inScratch(async (file) => {
	assert.equal(await new CounterStore(file).read(), 0);
	for (const damaged of ["{", '{"count":"3"}', '{"count":-1}', '{"count":1.5}', "null"]) {
		writeFileSync(file, damaged);
		assert.equal(await new CounterStore(file).read(), 0, damaged);
	}
}));

test("the count is kept for the next store, as whole JSON", inScratch(async (file) => {
	assert.equal(await new CounterStore(file).increment(), 1);
	assert.equal(await new CounterStore(file).increment(), 2);
	assert.equal(await new CounterStore(file).read(), 2);
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { count: 2 });
}));

test("increments at once all count, and a read waits for them", inScratch(async (file) => {
	const store = new CounterStore(file);
	const counts = await Promise.all([store.increment(), store.increment(), store.increment()]);
	assert.deepEqual(counts, [1, 2, 3]);
	const pending = store.increment();
	assert.equal(await store.read(), 4);
	await pending;
}));
