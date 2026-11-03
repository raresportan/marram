// The ratchet: a site off the list fails with the fix, and the list only shrinks.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { lineOf, ratchet, restrict } from "../../src/core/ratchet.mjs";

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
			`${join("src", "deep", "stray.tsx")}:2 calls danger: call it from owner.ts, or list it in lint.mjs with why`,
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
