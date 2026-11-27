// A project tells Marram what its gate runs and what its review fixes are held to in `marram.config.mjs`, at its root:
//
//   export default {
//     gate: {
//       logs: "where each run's logs go",   // .verify unless set
//       keep: 20,   // how many of the gate's runs to keep logs for, the newest; 20 unless set (Infinity keeps all)
//       progress: /lines from a stage worth showing as it runs/,   // besides ✓ and ✗ lines
//       sleepGapMs: 30000,   // how long a pause counts as the machine sleeping, so a stage that failed runs again
//       tiers: { fast: [stage, …], default: [stage, …], full: [stage, …] },  // stage: { name, run: [command, …args], env? }
//       prePush: "full",   // the gate a push must pass (marram hook pre-push): "default" unless set
//     },
//     probes: { … },   // see probe.mjs
//     replay: { setup: [command, …args], timeoutMs: 300000 },   // see replay.mjs
//     review: {
//       classes: "the mistake-classes doc",
//       rungs: ["type", "lint", …],
//       subjects: /the subjects of commits that fix review findings/,   // review findings, PR feedback, nits… unless set
//     },
//   };
//
// It's checked when it's loaded, all of it, whichever command runs: a misspelled key or a value of the wrong kind is
// named then, rather than ignored or failing later inside a command that happens to read it.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FILE = "marram.config.mjs";

/** The project root: the nearest folder from `from` up that has a marram.config.mjs, or undefined when none does. */
export function findRoot(from = process.cwd()) {
	for (let dir = resolve(from); ; dir = dirname(dir)) {
		if (existsSync(join(dir, FILE))) return dir;
		if (dirname(dir) === dir) return undefined;
	}
}

/** The project root, the nearest folder from `from` up that has a marram.config.mjs, and its config, checked. */
export async function load(from = process.cwd()) {
	const root = findRoot(from);
	if (root === undefined) throw new Error(`No ${FILE} in ${resolve(from)} or above it.`);
	const file = join(root, FILE);
	const config = (await import(pathToFileURL(file).href)).default;
	const found = problems(config);
	if (found.length > 0) throw new Error(`${file} isn't what Marram reads:\n${found.map((problem) => `  ${problem}`).join("\n")}`);
	return { root, config };
}

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof RegExp);
const isText = (value) => typeof value === "string" && value !== "";
/** A command and its arguments: the command is named, and an argument may be empty. */
export const isCommand = (value) => Array.isArray(value) && isText(value[0]) && value.every((part) => typeof part === "string");
const isPositive = (value) => typeof value === "number" && !Number.isNaN(value) && value > 0;
const isMs = (value) => isPositive(value) && Number.isFinite(value);

/** How many single-character edits (an insertion, a deletion, a change or two neighbors swapped) turn `a` into `b`. */
function distance(a, b) {
	const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
		}
	}
	return d[a.length][b.length];
}

/** A problem for each key of `object` (at `path`) that isn't one of `known`, with the one it's likely a misspelling of. */
function unknownKeys(object, path, known) {
	return Object.keys(object).filter((key) => !known.includes(key)).map((key) => {
		const [near] = known.map((name) => ({ name, edits: distance(key.toLowerCase(), name.toLowerCase()) }))
			.filter(({ edits }) => edits <= 2).sort((a, b) => a.edits - b.edits).map(({ name }) => name);
		return `${path}${path ? "." : ""}${key} isn't something Marram reads${near ? `: did you mean ${path}${path ? "." : ""}${near}?` : ` (it reads ${known.join(", ")})`}`;
	});
}

/** What's wrong with a stage of a tier. */
function stageProblems(stage, label) {
	if (!isObject(stage)) return [`${label} must be a stage: { name, run: [command, …args], env? }`];
	return [
		...unknownKeys(stage, label, ["name", "run", "env"]),
		...(!isText(stage.name) || /[\\/]/.test(stage.name) ? [`${label}.name must be a name, without / or \\: its log is <name>.log`] : []),
		...(!isCommand(stage.run) ? [`${label}.run must be a command and its arguments, as in ["npm", "test"]`] : []),
		...(stage.env !== undefined && !(isObject(stage.env) && Object.values(stage.env).every((value) => typeof value === "string"))
			? [`${label}.env must be an object of environment variables, each a string`] : []),
	];
}

/** What's wrong with `gate`. */
function gateProblems(gate) {
	if (!isObject(gate)) return ["gate must be an object: { logs, tiers, … }"];
	const found = unknownKeys(gate, "gate", ["logs", "keep", "progress", "sleepGapMs", "tiers", "prePush"]);
	if (gate.logs !== undefined && !isText(gate.logs)) found.push("gate.logs must be a folder in the project");
	if (gate.keep !== undefined && !(isPositive(gate.keep) && (Number.isInteger(gate.keep) || gate.keep === Infinity))) found.push("gate.keep must be how many runs to keep logs for: a whole number above 0, or Infinity");
	if (gate.progress !== undefined && !(gate.progress instanceof RegExp)) found.push("gate.progress must be a RegExp");
	if (gate.sleepGapMs !== undefined && !isMs(gate.sleepGapMs)) found.push("gate.sleepGapMs must be a positive number of milliseconds");
	if (gate.prePush !== undefined && !["default", "full"].includes(gate.prePush)) found.push(`gate.prePush is ${JSON.stringify(gate.prePush)}: a push can require the default gate or the full one ("default" or "full")`);
	if (!isObject(gate.tiers)) return [...found, "gate.tiers must be an object of tiers: { fast, default, full }, each a list of stages"];
	found.push(...unknownKeys(gate.tiers, "gate.tiers", ["fast", "default", "full"]));
	for (const tier of ["fast", "default", "full"]) {
		const stages = gate.tiers[tier];
		if (stages === undefined) continue;
		if (!Array.isArray(stages)) {
			found.push(`gate.tiers.${tier} must be a list of stages`);
			continue;
		}
		stages.forEach((stage, i) => {
			found.push(...stageProblems(stage, `gate.tiers.${tier}[${i}]`));
			if (isText(stage?.name) && stages.findIndex((other) => other?.name === stage.name) !== i) found.push(`gate.tiers.${tier}[${i}]: another stage in ${tier} is named "${stage.name}", and each has its own log`);
		});
	}
	return found;
}

/** What's wrong with `probes`, apart from what the working tree has to hold, which probe checks when it runs. */
export function probesProblems(probes) {
	if (!isObject(probes)) return ["probes must be an object: { faults, … }"];
	const found = unknownKeys(probes, "probes", ["setup", "link", "timeoutMs", "faults"]);
	if (probes.setup !== undefined && !isCommand(probes.setup)) found.push('probes.setup must be a command and its arguments, as in ["npm", "ci"]');
	if (probes.link !== undefined && !(Array.isArray(probes.link) && probes.link.every(isText))) found.push("probes.link must be a list of paths");
	if (probes.timeoutMs !== undefined && !isMs(probes.timeoutMs)) found.push("probes.timeoutMs must be a positive number of milliseconds");
	const { faults } = probes;
	if (!Array.isArray(faults) || faults.length === 0) return [...found, "marram.config.mjs has no probes.faults"];
	faults.forEach((fault, i) => {
		const label = `probes.faults[${i}]${typeof fault?.name === "string" ? ` ("${fault.name}")` : ""}`;
		if (!isObject(fault)) return found.push(`${label} must be a fault: { name, patch, run and expect, or test }`);
		found.push(...unknownKeys(fault, `probes.faults[${i}]`, ["name", "patch", "run", "expect", "test", "cwd"]));
		if (!isText(fault.name)) found.push(`${label} needs a name`);
		if (!isText(fault.patch)) found.push(`${label} needs a patch`);
		// One way or the other, with nothing of the other way: probe takes the test whenever there is one.
		const byCommand = isCommand(fault.run) && (fault.expect instanceof RegExp || isText(fault.expect)) && fault.test === undefined;
		const byTest = ["file", "name", "assertion"].every((key) => isText(fault.test?.[key])) && fault.run === undefined && fault.expect === undefined;
		if (!byCommand && !byTest) found.push(`${label} needs either run and expect, or test: { file, name, assertion }`);
		if (isObject(fault.test)) found.push(...unknownKeys(fault.test, `probes.faults[${i}].test`, ["file", "name", "assertion"]));
		if (fault.cwd !== undefined && !isText(fault.cwd)) found.push(`${label}: cwd must be a path in the project`);
		if (isText(fault.name) && faults.findIndex((other) => other?.name === fault.name) !== i) found.push(`${label}: another fault has that name`);
	});
	return found;
}

/** What's wrong with `replay`. */
export function replayProblems(replay) {
	if (!isObject(replay)) return ["replay must be an object: { setup, timeoutMs }"];
	return [
		...unknownKeys(replay, "replay", ["setup", "timeoutMs"]),
		...(replay.setup !== undefined && !isCommand(replay.setup) ? ['replay.setup in marram.config.mjs must be a command and its arguments, as in ["npm", "ci"]'] : []),
		...(replay.timeoutMs !== undefined && !isMs(replay.timeoutMs) ? ["replay.timeoutMs in marram.config.mjs must be a positive number of milliseconds"] : []),
	];
}

/** What's wrong with `review`. */
function reviewProblems(review) {
	if (!isObject(review)) return ["review must be an object: { classes, rungs, subjects }"];
	return [
		...unknownKeys(review, "review", ["classes", "rungs", "subjects"]),
		...(!isText(review.classes) ? ["review.classes must be the path of the mistake-classes doc"] : []),
		...(review.rungs !== undefined && !(Array.isArray(review.rungs) && review.rungs.length > 0 && review.rungs.every(isText)) ? ["review.rungs must be a list of rung names"] : []),
		...(review.subjects !== undefined && !(review.subjects instanceof RegExp) ? ["review.subjects must be a RegExp, the subjects of review-fix commits"] : []),
	];
}

/** Everything wrong with a marram.config.mjs's default export: none of it is required, but what's there must be right. */
export function problems(config) {
	if (!isObject(config)) return [`its default export must be an object: { gate, probes, replay, review }`];
	return [
		...unknownKeys(config, "", ["gate", "probes", "replay", "review"]),
		...(config.gate === undefined ? [] : gateProblems(config.gate)),
		...(config.probes === undefined ? [] : probesProblems(config.probes)),
		...(config.replay === undefined ? [] : replayProblems(config.replay)),
		...(config.review === undefined ? [] : reviewProblems(config.review)),
	];
}
