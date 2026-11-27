// Builds that overlap (npm install's prepare, the gate's first stage, a probe's setup) each finish, and what reads the
// package meanwhile always finds every compiled file. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const PKG = join(import.meta.dirname, "../..");
const SRC = join(PKG, "src");

test("builds that overlap all pass, and the compiled files are there throughout", async () => {
	const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"));
	assert.ok(sources.length > 0);
	const outputs = sources.flatMap((file) => [file.replace(/\.ts$/, ".js"), file.replace(/\.ts$/, ".d.ts")]);
	const builds = [0, 1, 2].map(() => new Promise((done) => {
		const child = spawn(process.execPath, [join(PKG, "scripts", "build.mjs")], { cwd: PKG, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		child.stdout.on("data", (chunk) => { output += chunk; });
		child.stderr.on("data", (chunk) => { output += chunk; });
		child.on("exit", (code) => done({ code, output }));
	}));
	let running = true;
	const all = Promise.all(builds).finally(() => { running = false; });
	const missing = new Set();
	while (running) {
		for (const file of outputs) if (!existsSync(join(SRC, file))) missing.add(file);
		await new Promise((done) => setTimeout(done, 5));
	}
	for (const { code, output } of await all) assert.equal(code, 0, output);
	assert.deepEqual([...missing], [], "a compiled file went missing while builds ran");
	for (const file of outputs) assert.ok(existsSync(join(SRC, file)), `${file} is there after`);
	assert.deepEqual(existsSync(join(PKG, ".build")) ? readdirSync(join(PKG, ".build")) : [], [], "no scratch folder is left");
});
