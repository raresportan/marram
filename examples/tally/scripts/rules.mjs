#!/usr/bin/env node
// Tally's fence: where code runs decides what it imports; only the store touches files; no floating promises, effects
// that copy state, lasting resources in passing, or comments in place of fixes.
import { resolve } from "node:path";
import { importBoundaryRule, importsOf } from "@raresportan/marram/core/boundaries";
import { lintChecks } from "@raresportan/marram/core/check-lint";
import { comments } from "@raresportan/marram/core/no-comments";
import { finish, runRules } from "@raresportan/marram/core/ratchet";
import { lintJourneys } from "@raresportan/marram/core/journey-lint";
import { FIX, lintPromises } from "@raresportan/marram/node/promise-lint";
import { acquisitions } from "@raresportan/marram/node/resource-lint";
import { effectSets } from "@raresportan/marram/react/effect-lint";

const root = resolve(import.meta.dirname, "..");
const list = "scripts/rules.mjs";

// Each file under src parsed once, for every rule.
const layers = {
	"features/*/shared": { may: [] },
	"features/*/host": { may: ["features/*/shared"], builtins: true },
	"features/*/client": { may: ["features/*/shared"] },
	main: { may: ["features/*/host", "features/*/shared"], builtins: true },
	preload: { may: ["features/*/shared"], builtins: true },
	renderer: { may: ["features/*/client", "features/*/shared"] },
};
const effects = (source, { file }) => effectSets(source).map(({ line, effect, setter }) => ({ key: `${file} ${setter}`, line, what: `${effect} sets ${setter} from its dependencies` }));

const problems = [
	...runRules({
		root,
		folder: "src",
		list,
		rules: [
			importBoundaryRule({ layers }),
			{ find: importsOf("fs"), owners: ["features/counter/host/store.ts"], allowed: {}, fix: "go through the counter's store", stale: "no longer touches files" },
			{ find: acquisitions, allowed: {}, fix: "start it through the module that owns it", stale: "no longer starts lasting resources" },
			{ find: comments, allowed: {}, fix: "say it in the code, or link the outside constraint", stale: "has no comments any more" },
			{ find: effects, allowed: {}, fix: "derive it while rendering, or hold it with useKeyed", stale: "is listed but no effect there sets it" },
		],
	}),
	...lintPromises({ root, projects: [{ config: "tsconfig.json", folder: "src" }] }).problems.map((problem) => `${problem}: ${FIX}`),
	...lintChecks({ root, folder: "scripts", match: /\.test\.ts$/ }).problems,
	...lintJourneys({ root, folder: "scripts/verify", tsconfig: "tsconfig.json" }).problems,
];
await finish("rules", problems, "the imports, the store, resources, comments, effects, promises and checks are all in order");
