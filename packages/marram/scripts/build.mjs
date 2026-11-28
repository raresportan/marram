// Compiles the package's TypeScript to .js and .d.ts beside each .ts (tsconfig.build.json). The package's own sources
// are .mjs, .ts and .d.mts, so every .js and .d.ts under src is a build's.
//
// Builds can overlap (npm install's prepare, the gate's first stage, a probe's setup), and what reads the package (a
// typecheck, Tally) may run while one does. So nothing is deleted first: a build compiles into a scratch folder of its
// own, renames each file over the one in src (a rename replaces a file whole, so a reader sees the old file or the new
// one, never none), and only then removes what a .ts deleted or renamed since left behind, which every build agrees on.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { renameOver } from "../src/core/owned.mjs";

const pkg = join(import.meta.dirname, "..");
const src = join(pkg, "src");
// In the package, beside src, so renaming out of it stays on one file system.
const scratch = join(pkg, ".build", `${process.pid}-${Date.now()}`);
const OUTPUT = /\.(js|d\.ts)$/;

try {
	// From the package's folder: TypeScript 7 doesn't export its bin/tsc, as 5 does.
	const tsc = join(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin", "tsc");
	execFileSync(process.execPath, [tsc, "-p", join(pkg, "tsconfig.build.json"), "--outDir", scratch], { stdio: "inherit" });
	for (const file of readdirSync(scratch, { recursive: true, encoding: "utf8" })) {
		if (!OUTPUT.test(file)) continue;
		mkdirSync(dirname(join(src, file)), { recursive: true });
		renameOver(join(scratch, file), join(src, file));
	}
	// What a .ts deleted or renamed since an earlier build left: its .js and .d.ts would otherwise be published.
	for (const file of readdirSync(src, { recursive: true, encoding: "utf8" })) {
		if (OUTPUT.test(file) && !existsSync(join(src, file.replace(OUTPUT, ".ts")))) rmSync(join(src, file), { force: true });
	}
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
