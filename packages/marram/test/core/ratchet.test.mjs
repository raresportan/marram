// The ratchet: a site off the list fails with the fix, and the list only shrinks.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { lineOf, ratchet, restrict, runRules } from "../../src/core/ratchet.mjs";

const rule = (allowed, found) => ratchet({ list: "lint.mjs", allowed, found, fix: "use the owner", stale: () => "no longer does it" });
const site = (key) => ({ key, at: `${key}:1`, what: "does it" });

test("a site off the list fails, naming the fix and the list", () => {
	assert.deepEqual(rule({ "a.ts": "why" }, [site("a.ts"), site("a.ts")]), []);
	assert.deepEqual(rule({}, [site("b.ts")]), ["b.ts:1 does it: use the owner, or list it in lint.mjs with why"]);
});

test("an entry with no reason fails", () => {
	assert.equal(rule({ "a.ts": "" }, [site("a.ts")]).length, 1);
	assert.equal(rule({ "a.ts": "  " }, [site("a.ts")]).length, 1);
});

test("an entry that no longer matches fails until it's removed", () => {
	assert.deepEqual(rule({ "a.ts": "why", "b.ts": "why" }, [site("a.ts")]), ["b.ts no longer does it: remove it from lint.mjs"]);
	const phrase = ratchet({ list: "lint.mjs", allowed: { "b.ts": "why" }, found: [], fix: "use the owner", stale: "is quiet now" });
	assert.deepEqual(phrase, ["b.ts is quiet now: remove it from lint.mjs"]);
});

test("restrict finds sites per file, skips the owners, and tells a gone file from a stale one", () => {
	const root = mkdtempSync(join(tmpdir(), "marram-ratchet-"));
	try {
		mkdirSync(join(root, "src", "deep"), { recursive: true });
		writeFileSync(join(root, "src", "owner.ts"), "danger();\n");
		writeFileSync(join(root, "src", "listed.ts"), "danger();\n");
		writeFileSync(join(root, "src", "deep", "stray.tsx"), "const x = 1;\ndanger();\n");
		writeFileSync(join(root, "src", "clean.ts"), "safe();\n");
		writeFileSync(join(root, "src", "types.d.ts"), "declare function danger(): void;\n");
		const find = (source) => {
			const sites = [];
			const visit = (node) => {
				if (ts.isIdentifier(node) && node.text === "danger") sites.push({ line: lineOf(source, node), what: "calls danger" });
				ts.forEachChild(node, visit);
			};
			visit(source);
			return sites;
		};
		const problems = restrict({
			root,
			folder: "src",
			owners: ["owner.ts"],
			find,
			allowed: { "listed.ts": "why", "clean.ts": "why", "removed.ts": "why" },
			list: "lint.mjs",
			fix: "call it from owner.ts",
			stale: "no longer calls danger",
		});
		assert.deepEqual(problems.sort(), [
			"clean.ts no longer calls danger: remove it from lint.mjs",
			"removed.ts is gone: remove it from lint.mjs",
			"src/deep/stray.tsx:2 calls danger: call it from owner.ts, or list it in lint.mjs with why",
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a counted file allowance tracks individual finder matches", () => {
	const root = mkdtempSync(join(tmpdir(), "marram-count-"));
	try {
		const run = (matches, allowance) => {
			writeFileSync(join(root, "old.ts"), "danger();\n".repeat(matches));
			return restrict({
				root, folder: ".", list: "rules", allowed: { "old.ts": allowance },
				find: (source) => source.statements.map((node) => ({ line: lineOf(source, node), what: "calls danger" })),
				fix: "use Scope", stale: "no longer calls danger",
			});
		};
		const entry = { reason: "pending migration", count: 3 };
		assert.deepEqual(run(3, entry), []);
		assert.match(run(4, entry)[0], /4 matches, allowance 3: use Scope/);
		assert.match(run(2, entry)[0], /lower its count from 3 to 2/);
		assert.match(run(0, entry)[0], /remove it from rules/);
		assert.match(run(3, { ...entry, reason: " " })[0], /without a reason/);
		for (const count of [0, -1, 1.5, "3", undefined]) {
			assert.match(run(3, { ...entry, count })[0], /positive integer/);
		}
		assert.deepEqual(run(4, "file-level exception"), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("runRules parses each file once for every rule, and judges each rule's sites against its own list", () => {
	const root = mkdtempSync(join(tmpdir(), "marram-rules-"));
	try {
		mkdirSync(join(root, "src", "deep"), { recursive: true });
		writeFileSync(join(root, "src", "owner.ts"), "danger();\n");
		writeFileSync(join(root, "src", "a.ts"), "danger();\nconst [v, setV] = s();\n");
		writeFileSync(join(root, "src", "deep", "b.tsx"), "setW(1);\n");
		const calls = (name) => (source) => source.statements.flatMap((node) => (node.getText(source).startsWith(name) ? [{ line: lineOf(source, node), what: `calls ${name}` }] : []));
		const seen = new Map();
		const remember = (rule) => ({ ...rule, find: (source, where) => {
			seen.set(where.file, [...(seen.get(where.file) ?? []), source]);
			return rule.find(source, where);
		} });
		const rules = [
			remember({ find: calls("danger"), owners: ["owner.ts"], allowed: { "gone.ts": "why" }, fix: "call it from owner.ts", stale: "no longer calls danger" }),
			// Sites with keys of their own, as the effects ratchet lists `file setter`.
			remember({
				find: (source, { file, files }) => {
					assert.ok(files.has("deep/b.tsx") && files.get(file).endsWith(file.split("/").join(process.platform === "win32" ? "\\" : "/")));
					return calls("setW")(source).map((found) => ({ ...found, key: `${file} setW` }));
				},
				allowed: { "a.ts setW": "why" },
				fix: "derive it",
				stale: "no longer sets it",
			}),
		];
		assert.deepEqual(runRules({ root, folder: "src", list: "rules.mjs", rules }), [
			"src/a.ts:1 calls danger: call it from owner.ts, or list it in rules.mjs with why",
			"gone.ts is gone: remove it from rules.mjs",
			"src/deep/b.tsx:1 calls setW: derive it, or list it in rules.mjs with why",
			"a.ts setW no longer sets it: remove it from rules.mjs",
		]);
		// Each file was parsed once: both rules saw the same tree. The owner was parsed, and skipped by its rule only.
		for (const [file, sources] of seen) assert.ok(sources.length === (file === "owner.ts" ? 1 : 2) && sources.every((source) => source === sources[0]), file);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
