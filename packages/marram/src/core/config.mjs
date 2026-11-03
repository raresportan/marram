// A project tells Marram what its gate runs and what its review fixes are held to in `marram.config.mjs`, at its root:
//
//   export default {
//     gate: {
//       logs: "where each run's logs go",
//       progress: /lines from a stage worth showing as it runs/,   // besides ✓ and ✗ lines
//       tiers: { fast: [stage, …], default: [stage, …], full: [stage, …] },  // stage: { name, run: [command, …args], env? }
//     },
//     review: { classes: "the mistake-classes doc", rungs: ["type", "lint", …] },
//   };
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FILE = "marram.config.mjs";

/** The project root, the nearest folder from `from` up that has a marram.config.mjs, and its config. */
export async function load(from = process.cwd()) {
	for (let dir = resolve(from); ; dir = dirname(dir)) {
		if (existsSync(join(dir, FILE))) return { root: dir, config: (await import(pathToFileURL(join(dir, FILE)).href)).default };
		if (dirname(dir) === dir) throw new Error(`No ${FILE} in ${resolve(from)} or above it.`);
	}
}
