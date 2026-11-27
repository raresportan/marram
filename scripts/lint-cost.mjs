#!/usr/bin/env node
// What a project's ratchet lints cost at a given size, and how much of that is parsing the same files again: the
// numbers to decide whether a runner that parses each file once is worth building. Usage:
//   node scripts/lint-cost.mjs [files…]   (1000 and 5000 unless given)
//
// The corpus is copies of the real TypeScript this repository has (node_modules' sources, Tally's, the package's), as
// many as asked for, laid out as features/*/client folders. Parsing costs by the amount of code, not what it says, so
// copies measure the same. It runs the five per-file passes Tally's rules make (importBoundaries, restrict with three
// finders, and the effects ratchet), each finder again on files already parsed, and lintPromises, which builds a
// type-checked program a shared parse can't help. Each time is the median of three runs, but lintPromises is one. Then
// the memory every file's syntax tree takes, kept, before and after the comments finder (which makes token nodes).
//
// Measured on a Mac in November 2026: at 1000 files (84k lines) the five passes took 1.2s and parse-once could save
// 0.6s; at 5000 files (420k lines), 6.5s and 3.1s, with 330MB to keep every tree (755MB after comments). So a runner
// worth building parses a file, runs every finder on it, and lets it go, rather than caching trees.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importBoundaries, importsOf } from "../packages/marram/src/core/boundaries.mjs";
import { comments } from "../packages/marram/src/core/no-comments.mjs";
import { parse, ratchet, restrict, sourceFiles } from "../packages/marram/src/core/ratchet.mjs";
import { lintPromises } from "../packages/marram/src/node/promise-lint.mjs";
import { acquisitions } from "../packages/marram/src/node/resource-lint.mjs";
import { effectSets } from "../packages/marram/src/react/effect-lint.mjs";

const REPO = join(import.meta.dirname, "..");
const SOURCE = /\.tsx?$/;
const DECLARATION = /\.d\.[cm]?ts$/;

/** The TypeScript sources under `folder`, declaration files aside, whatever folder they're in. */
function sources(folder) {
	return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
		const path = join(folder, entry.name);
		if (entry.isDirectory()) return sources(path);
		return SOURCE.test(entry.name) && !DECLARATION.test(entry.name) ? [path] : [];
	});
}

/** Median ms of `runs` calls of `work`. */
function time(work, runs = 3) {
	const ms = [];
	for (let i = 0; i < runs; i++) {
		const start = performance.now();
		work();
		ms.push(performance.now() - start);
	}
	return Math.round(ms.sort((a, b) => a - b)[Math.floor(runs / 2)]);
}

/** A corpus of `count` files copied from `pool`, in a temporary folder with a tsconfig; its size. */
function corpus(pool, count) {
	const root = mkdtempSync(join(tmpdir(), "marram-lint-cost-"));
	let bytes = 0;
	let lines = 0;
	for (let i = 0; i < count; i++) {
		const from = pool[i % pool.length];
		const folder = join(root, "src", "features", `f${Math.floor(i / 20)}`, "client");
		mkdirSync(folder, { recursive: true });
		const to = join(folder, `m${i}${from.endsWith("x") ? ".tsx" : ".ts"}`);
		copyFileSync(from, to);
		bytes += statSync(to).size;
		lines += readFileSync(to, "utf8").split("\n").length;
	}
	writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true, jsx: "preserve", skipLibCheck: true, types: [] }, include: ["src"] }));
	return { root, kb: Math.round(bytes / 1024), lines };
}

/** The times at `count` files. */
function measure(pool, count) {
	const { root, kb, lines } = corpus(pool, count);
	try {
		const files = sourceFiles(join(root, "src"));
		const parsed = files.map(parse);
		const list = "rules.mjs";
		const restricted = (find) => () => restrict({ root, folder: "src", find, allowed: {}, list, fix: "-", stale: "-" });
		const effects = () => ratchet({ list, allowed: {}, found: files.flatMap((file) => effectSets(parse(file)).map(() => ({ key: file, at: file, what: "-" }))), fix: "-", stale: "-" });
		const passes = {
			"restrict importsOf(fs)": time(restricted(importsOf("fs"))),
			"restrict acquisitions": time(restricted(acquisitions)),
			"restrict comments": time(restricted(comments)),
			"effects ratchet": time(effects),
			importBoundaries: time(() => importBoundaries({ root, folder: "src", layers: { "features/*/client": { may: [] } }, list })),
		};
		const once = time(() => files.map(parse));
		const total = Object.values(passes).reduce((sum, ms) => sum + ms, 0);
		return {
			files: count,
			kb,
			lines,
			"one parse of every file (ms)": once,
			"finders on files already parsed (ms)": {
				"importsOf(fs)": time(() => parsed.forEach(importsOf("fs"))),
				acquisitions: time(() => parsed.forEach(acquisitions)),
				comments: time(() => parsed.forEach(comments)),
				effectSets: time(() => parsed.forEach(effectSets)),
			},
			"the five passes (ms)": passes,
			"the five passes, total (ms)": total,
			"parse-once could save at most (ms)": (Object.keys(passes).length - 1) * once,
			"lintPromises (ms)": time(() => lintPromises({ root, projects: [{ config: "tsconfig.json", folder: "src" }] }), 1),
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

/** MB of heap that every file's tree takes at `count` files, kept, in a process that can collect garbage. */
function memory(count) {
	const child = spawnSync(process.execPath, ["--expose-gc", import.meta.filename, "--memory", String(count)], { encoding: "utf8" });
	if (child.status !== 0) throw new Error(child.stderr);
	return JSON.parse(child.stdout);
}

const pool = ["node_modules", "examples/tally/src", "packages/marram/src"].flatMap((folder) => sources(join(REPO, folder)));
if (process.argv[2] === "--memory") {
	const count = Number(process.argv[3]);
	const heap = () => {
		globalThis.gc();
		return process.memoryUsage().heapUsed;
	};
	const before = heap();
	const kept = Array.from({ length: count }, (_, i) => parse(pool[i % pool.length]));
	const trees = heap();
	kept.forEach(comments);
	const tokens = heap();
	console.log(JSON.stringify({ "every tree kept (MB)": Math.round((trees - before) / 2 ** 20), "after comments (MB)": Math.round((tokens - before) / 2 ** 20) }));
} else {
	const counts = process.argv.slice(2).map(Number);
	console.log(`A corpus from ${pool.length} real TypeScript files.`);
	for (const count of counts.length > 0 ? counts : [1000, 5000]) console.log(JSON.stringify({ ...measure(pool, count), ...memory(count) }, null, 1));
}
