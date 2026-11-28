#!/usr/bin/env node
// Marram's TLA+ models, checked by everystate over every interleaving of their steps. Each model is checked as it is,
// where its invariants must hold, and with a part of the design switched off, where the invariant that part is for
// must fail: a model that can't find the bug it's for proves nothing about its absence.
//   models/Lock.tla: withLock (owned.mjs), whose lock never has two running holders, though any process may pause
//   between any two steps or die at any. Without the check after publishing, two processes both go in.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { finish } from "@raresportan/marram/core/ratchet";

const root = resolve(import.meta.dirname, "..");
const models = join(root, "models");
// The package exports only its WebAssembly entry, wasm/everystate.mjs: the launcher, which runs the native binary for
// this platform, is beside it in bin.
const launcher = join(dirname(dirname(createRequire(import.meta.url).resolve("everystate"))), "bin", "everystate.mjs");

const CHECKS = [
	{ spec: "Lock.tla", config: "Lock.cfg", expect: { status: "ok" } },
	{ spec: "Lock.tla", config: "LockUnchecked.cfg", expect: { status: "invariant", name: "Mutex" } },
];

/** everystate's result for `spec` under `config`, as JSON: `{ status, name?, distinct, … }`. */
function check(spec, config) {
	const result = spawnSync(process.execPath, [launcher, "-json", "-config", config, spec], { cwd: models, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	try {
		return JSON.parse(result.stdout);
	} catch {
		return { status: "error", name: (result.stderr || result.error?.message || "no result").trim().split("\n")[0] };
	}
}

const problems = [];
for (const { spec, config, expect } of CHECKS) {
	const result = check(spec, config);
	const as = Object.entries(expect).every(([key, value]) => result[key] === value);
	const said = `${result.status}${result.name ? ` (${result.name})` : ""}`;
	if (as) console.log(`✓ ${spec} with ${config}: ${said}, ${result.distinct ?? "?"} states`);
	else problems.push(`${spec} with ${config} gave ${said}, where it must give ${expect.status}${expect.name ? ` (${expect.name})` : ""}`);
}
await finish("models", problems, "every model holds as it is, and fails where a part of it is switched off");
