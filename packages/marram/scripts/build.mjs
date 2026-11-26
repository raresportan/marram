// Compiles the package's TypeScript in place, to .js and .d.ts beside each .ts (tsconfig.build.json). What an earlier
// build left goes first: a .ts deleted or renamed since would otherwise leave its .js and .d.ts to be published. The
// package's own sources are .mjs, .ts and .d.mts, so every .js and .d.ts under src is a build's.
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const pkg = join(import.meta.dirname, "..");
const src = join(pkg, "src");
for (const file of readdirSync(src, { recursive: true, encoding: "utf8" })) {
	if (/\.(js|d\.ts)$/.test(file)) rmSync(join(src, file));
}
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tsc, "-p", join(pkg, "tsconfig.build.json")], { stdio: "inherit" });
