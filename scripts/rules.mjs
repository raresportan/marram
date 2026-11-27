#!/usr/bin/env node
// Marram's own ratchets, for mistakes it has made more than once (docs/mistake-classes.md):
//   - lifetime: a command that calls process.exit straight after writing can cut its output short, since to a pipe a
//     write finishes later (on macOS). Exits go through exitWhenWritten, which waits for them.
//   - check: a pattern a project gives may have the g or y flag, and then test() and exec() start where its last match
//     ended. A pattern the file didn't write is matched through pattern.mjs, which starts from the text's start.
//   - shared: a file written in place can be read half written, and a removal can take what another run is using. A
//     file goes through owned.mjs (writeWhole), and so does a run's folder (ownFolder) and a lock; anywhere else a
//     write, rename or removal is listed below with why the place is this run's alone.
import { resolve } from "node:path";
import ts from "typescript";
import { finish, lineOf, runRules } from "@raresportan/marram/core/ratchet";

const root = resolve(import.meta.dirname, "..");
const list = "scripts/rules.mjs";
// The hand-written modules and the TypeScript sources; what the build emits from them is the sources' to answer for.
const match = /^(?!.*\.d\.m?ts$).*\.(?:mjs|ts)$/;

/** Every call in `source` that `pick(call)` keeps, as a site. */
const calls = (source, pick, what) => {
	const sites = [];
	const visit = (node) => {
		if (ts.isCallExpression(node) && pick(node)) sites.push({ line: lineOf(source, node), what: what(node) });
		ts.forEachChild(node, visit);
	};
	visit(source);
	return sites;
};

const isProcessExit = (call) => ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "exit"
	&& ts.isIdentifier(call.expression.expression) && call.expression.expression.text === "process";
const exits = (source) => calls(source, isProcessExit, () => "calls process.exit");

/** A pattern written here: a literal, or `new RegExp(…)`. */
const isWritten = (node) => ts.isRegularExpressionLiteral(node) || (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "RegExp");

/** The names the file binds to a pattern it writes, or to an arrow function that returns one it writes. */
function ownPatterns(source) {
	const values = new Set();
	const makers = new Set();
	const visit = (node) => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			if (isWritten(node.initializer)) values.add(node.name.text);
			if (ts.isArrowFunction(node.initializer) && isWritten(node.initializer.body)) makers.add(node.name.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return { values, makers };
}

const isMatchCall = (call) => ts.isPropertyAccessExpression(call.expression) && ["test", "exec"].includes(call.expression.name.text);
function patterns(source) {
	const { values, makers } = ownPatterns(source);
	const written = (receiver) => {
		const value = ts.isParenthesizedExpression(receiver) ? receiver.expression : receiver;
		return isWritten(value) || (ts.isIdentifier(value) && values.has(value.text))
			|| (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && makers.has(value.expression.text));
	};
	return calls(source, (call) => isMatchCall(call) && !written(call.expression.expression), (call) => `calls ${call.expression.getText(source)} on a pattern it didn't write`);
}

const FILE_CHANGES = new Set(["writeFileSync", "writeFile", "appendFileSync", "appendFile", "createWriteStream", "renameSync", "rename", "rmSync", "rm"]);
const calleeName = (call) => (ts.isIdentifier(call.expression) ? call.expression.text : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : undefined);
const fileChanges = (source) => calls(source, (call) => FILE_CHANGES.has(calleeName(call)), (call) => `${calleeName(call)} in place`);

const rules = [
	{ find: exits, owners: ["core/json-output.mjs"], allowed: {}, fix: "await exitWhenWritten (json-output.mjs), which exits once the output is written", stale: "no longer calls process.exit" },
	{ find: patterns, owners: ["core/pattern.mjs"], allowed: {}, fix: "match it with matches or firstMatch (pattern.mjs), from the text's start", stale: "no longer matches a pattern it didn't write" },
	{
		find: fileChanges,
		owners: ["core/owned.mjs"],
		allowed: {
			"core/gate-state.mjs": { count: 5, reason: "treeOf's index copy is in a folder mkdtemp made for it, which it removes; the secret is written to a file of this process's own, made owner-only and published by a hard link that fails if one is there, which writeWhole's rename would replace" },
			"core/gate.mjs": { count: 3, reason: "stage logs are streamed into, and renamed within, the run's own folder (ownFolder); the removal is of a folder 0.3 was making when its gate died" },
			"core/guard-diff.mjs": { count: 1, reason: "removes its scratch folder, which scratchFolder (mkdtemp) made for this run" },
			"core/init.mjs": { count: 1, reason: "appends a line to the project's .gitignore: rewriting it whole would drop an edit made meanwhile" },
			"core/probe.mjs": { count: 5, reason: "all inside the probe's scratch folder, which scratchFolder (mkdtemp) made for this run: the copy's reset and its observations file, and the folder itself" },
			"core/replay.mjs": { count: 3, reason: "the check is written into a checkout in replay's scratch folder, which scratchFolder (mkdtemp) made for this run, and that folder is removed" },
			"electron/session.ts": { count: 5, reason: "the bootstrap has a name of this session's own and is removed at dispose; the scratch folder is mkdtemp's, for this session; electron.log is appended in the journey's evidence folder as Electron writes, which a later write can't replace whole" },
		},
		fix: "write it whole (writeWhole), in a folder of the run's own (ownFolder), through owned.mjs",
		stale: "no longer writes, renames or removes files in place",
	},
];

const problems = [
	...runRules({ root, folder: "packages/marram/src", list, rules, match }),
	// bin has no listed sites: what's listed is src's.
	...runRules({ root, folder: "packages/marram/bin", list, rules: rules.map((rule) => ({ ...rule, allowed: {} })), match }),
];
await finish("rules", problems, "exits wait for the output, patterns a project gives match from the start, and files are written whole");
