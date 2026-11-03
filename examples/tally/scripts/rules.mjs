#!/usr/bin/env node
// Tally's fence: where code runs decides what it imports; only the store touches files; no floating promises, effects
// that copy state, lasting resources in passing, or comments in place of fixes.
import { relative, resolve } from "node:path";
import ts from "typescript";
import { importBoundaries } from "@raresportan/marram/core/boundaries";
import { lintChecks } from "@raresportan/marram/core/check-lint";
import { comments } from "@raresportan/marram/core/no-comments";
import { finish, lineOf, parse, ratchet, restrict, sourceFiles } from "@raresportan/marram/core/ratchet";
import { lintJourneys } from "@raresportan/marram/electron/journey-lint";
import { FIX, lintPromises } from "@raresportan/marram/node/promise-lint";
import { acquisitions } from "@raresportan/marram/node/resource-lint";
import { effectSets } from "@raresportan/marram/react/effect-lint";

const root = resolve(import.meta.dirname, "..");
const list = "scripts/rules.mjs";

/** Where a file imports what reads or writes files. */
function fileAccess(source) {
	return source.statements.flatMap((statement) =>
		ts.isImportDeclaration(statement) && /^(node:)?fs(\/promises)?$/.test(statement.moduleSpecifier.text) ? [{ line: lineOf(source, statement), what: `imports ${statement.moduleSpecifier.text}` }] : [],
	);
}

const effects = sourceFiles(resolve(root, "src")).flatMap((file) => {
	const name = relative(root, file);
	return effectSets(parse(file)).map(({ line, effect, setter }) => ({ key: `${name} ${setter}`, at: `${name}:${line}`, what: `${effect} sets ${setter} from its dependencies` }));
});

const problems = [
	...importBoundaries({
		root,
		folder: "src",
		layers: {
			"features/*/shared": { may: [] },
			"features/*/host": { may: ["features/*/shared"], builtins: true },
			"features/*/client": { may: ["features/*/shared"] },
			main: { may: ["features/*/host", "features/*/shared"], builtins: true },
			preload: { may: ["features/*/shared"], builtins: true },
			renderer: { may: ["features/*/client", "features/*/shared"] },
		},
		list,
	}),
	...restrict({ root, folder: "src", owners: ["features/counter/host/store.ts"], find: fileAccess, allowed: {}, list, fix: "go through the counter's store", stale: "no longer touches files" }),
	...restrict({ root, folder: "src", find: acquisitions, allowed: {}, list, fix: "start it through the module that owns it", stale: "no longer starts lasting resources" }),
	...restrict({ root, folder: "src", find: comments, allowed: {}, list, fix: "say it in the code, or link the outside constraint", stale: "has no comments any more" }),
	...ratchet({ list, allowed: {}, found: effects, fix: "derive it while rendering, or hold it with useKeyed", stale: "is listed but no effect there sets it" }),
	...lintPromises({ root, projects: [{ config: "tsconfig.json", folder: "src" }] }).problems.map((problem) => `${problem}: ${FIX}`),
	...lintChecks({ root, folder: "scripts", match: /\.test\.ts$/ }).problems,
	...lintJourneys({ root, folder: "scripts/verify", tsconfig: "tsconfig.json" }).problems,
];
finish("rules", problems, "the imports, the store, resources, comments, effects, promises and checks are all in order");
