// One gate for every change, so "green" means the same thing by hand, in a hook, in CI and in an agent's done-check.
// Usage: marram gate [fast | full]
//   fast      Seconds: after each edit.
//   (default) Minutes: before a task counts as done.
//   full      The default gate and more (a build, the slow journeys). Before merging UI work, or nightly.
// What each tier runs is the project's: `gate.tiers` in marram.config.mjs. Stages run in order and the first failure
// stops the gate. Each stage's output is kept in its own log under `gate.logs`/gate-<tier>-<time>-<pid>/, with report.json;
// the newest `gate.keep` runs' folders are kept, 20 unless set, and a run still going is never removed.
// A stage that fails after the machine slept during it runs again: timeouts ran out and frames stopped while it slept,
// so that failure says nothing about the code. A pause counts as sleep past `gate.sleepGapMs`, 30 seconds by default.
// The default and full gates record their verdict for the working tree (gate-state.mjs), which the hooks reuse.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { COVERS_DEFAULT, projectTreeKey, stageKeys, stageText, treeOf, updateState, verdictKey } from "./gate-state.mjs";
import { spawnable } from "./command.mjs";
import { failureExcerpt } from "./failure-excerpt.mjs";
import { matches } from "./pattern.mjs";
import { alive, ownFolder, removeAbandoned, removeIfDone, writeWhole } from "./owned.mjs";
import { exitWhenWritten, jsonOption, printJson } from "./json-output.mjs";

const TIERS = ["fast", "default", "full"];
// A run's folder: its tier, when it started, and its gate's process id, so two gates starting in the same millisecond
// don't share one. Folders from before the id was added match too, so they're still pruned.
const RUN = /^gate-(?:fast|default|full)-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z)(?:-\d+)?$/;
// A run's folder as 0.3 made it, before ownFolder: `.gate-<tier>-<time>-<pid>`. One a dead gate left is still pruned.
const STARTED_BY_0_3 = /^\.gate-(?:fast|default|full)-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-(\d+)$/;

/**
 * Removes all but the newest `keep` of the gate's run folders in `logs`, whatever their tier, except a run that may still
 * be going (owned.mjs: inUse); and a folder a gate was making when it died. Only the gate's own folders are touched:
 * anything else a project keeps there stays.
 */
export async function pruneLogs(logs, keep) {
	const entries = (await readdir(logs, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory());
	const runs = entries
		.filter((entry) => RUN.test(entry.name))
		.map((entry) => ({ name: entry.name, time: RUN.exec(entry.name)[1] }))
		.sort((a, b) => b.time.localeCompare(a.time) || b.name.localeCompare(a.name));
	for (const { name } of runs.slice(keep)) removeIfDone(join(logs, name));
	removeAbandoned(logs, (name) => RUN.test(name));
	for (const entry of entries) {
		const [, pid] = STARTED_BY_0_3.exec(entry.name) ?? [];
		if (pid !== undefined && !alive(Number(pid))) await rm(join(logs, entry.name), { recursive: true, force: true });
	}
}

/**
 * A new run's folder in `logs`, for `tier`, started at `date`: the gate's own while it runs (owned.mjs: ownFolder), so
 * another gate pruning meanwhile, in another terminal or a hook, leaves it.
 */
export async function startRun(logs, tier, date = new Date()) {
	return ownFolder(logs, `gate-${tier}-${date.toISOString().replace(/[:.]/g, "-")}-${process.pid}`).path;
}

/**
 * Whether the full tier runs each default stage, in order, with the same command, arguments and environment, and runs
 * together exactly the default stages the default tier runs together; other stages may come between them. A stage
 * between two marked ones in full splits their group, so they run apart there and together by default, where one may
 * break the other. Tiers are the project's, so a full gate needn't contain the default one, and its pass then says
 * nothing about the default gate.
 */
export function ranDefault(tiers) {
	if (!Array.isArray(tiers.default) || !Array.isArray(tiers.full)) return false;
	const wanted = tiers.default.map(stageText);
	let found = 0;
	// The full tier's groups, each narrowed to the default stages in it, by their place in the default tier.
	const ran = [];
	for (const group of groups(tiers.full)) {
		const mine = [];
		for (const stage of group) if (found < wanted.length && stageText(stage) === wanted[found]) mine.push(found++);
		if (mine.length > 0) ran.push(mine);
	}
	if (found !== wanted.length) return false;
	let next = 0;
	const expected = groups(tiers.default).map((group) => group.map(() => next++));
	return JSON.stringify(ran) === JSON.stringify(expected);
}

/**
 * `stages` in the groups they run in: each stage alone, in order, but consecutive ones marked `concurrent` together. A
 * stage runs once the groups before it finished, so one that needs another's output (a typecheck after a build) stays
 * after it, unmarked.
 */
export function groups(stages) {
	const found = [];
	for (const stage of stages) {
		if (stage.concurrent === true && found.at(-1)?.[0].concurrent === true) found.at(-1).push(stage);
		else found.push([stage]);
	}
	return found;
}

export async function gate(root, config, given) {
	const { json, args, say } = jsonOption(given);
	const [tier = "default"] = args;
	if (!TIERS.includes(tier)) {
		console.error(`Unknown gate "${tier}". Usage: marram gate [fast | full] [--json]`);
		await exitWhenWritten(1);
	}
	const { logs = ".verify", keep = 20, progress, tiers, sleepGapMs = 30_000 } = config.gate ?? {};
	if (!Array.isArray(tiers?.[tier])) {
		console.error(`marram.config.mjs has no gate.tiers.${tier}: a list of stages.`);
		await exitWhenWritten(1);
	}
	const dir = await startRun(join(root, logs), tier);
	await pruneLogs(join(root, logs), keep);
	const report = { tier, startedAt: new Date().toISOString(), stages: [], passed: false };
	// One write at a time: stages running together finish together, and two writes of one file at once can interleave.
	let saving = Promise.resolve();
	const saveReport = () => (saving = saving.then(() => writeWhole(join(dir, "report.json"), JSON.stringify(report, null, 2))));

	// A git hook (pre-push) runs with GIT_DIR and the like pointing at this repository; checks that make their own scratch
	// repositories would act on this one instead.
	const outsideGit = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

	// Interrupted (Ctrl-C, a hook's timeout), the gate passes the signal to the stages it runs, so a check runner can stop
	// what it started, and records no verdict: an interrupted gate says nothing about the code.
	const running = new Set();
	let interrupted = false;
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
		process.once(signal, () => {
			interrupted = true;
			for (const child of running) child.kill(signal);
		});
	}

	async function runStage({ name, run: [command, ...args], env = {} }) {
		const started = Date.now();
		const log = createWriteStream(join(dir, `${name}.log`));
		const stageEnv = { ...outsideGit, ...env };
		const run = spawnable(command, args, { cwd: root, env: stageEnv });
		const child = spawn(run.file, run.args, { ...run.options, cwd: root, env: stageEnv, stdio: ["ignore", "pipe", "pipe"] });
		running.add(child);
		child.stdout.pipe(log, { end: false });
		child.stderr.pipe(log, { end: false });
		// Progress lines (a check's ✓ or ✗, and what the project's `progress` matches); everything else stays in the log.
		child.stdout.on("data", (chunk) => {
			for (const line of chunk.toString().split("\n")) if (/^\s*[✓✗]/.test(line) || (progress !== undefined && matches(progress, line))) say(`  ${name}: ${line.trim()}`);
		});
		let last = Date.now();
		let slept = 0;
		const noticeSleep = () => {
			const gap = Date.now() - last;
			last += gap;
			if (gap > sleepGapMs) slept += gap;
		};
		const clock = setInterval(noticeSleep, 1000);
		const code = await new Promise((done) => {
			child.on("error", (error) => log.write(error.message + "\n"));
			child.on("close", (exit) => done(exit ?? 1));
		});
		running.delete(child);
		clearInterval(clock);
		noticeSleep();
		await new Promise((done) => log.end(done));
		const seconds = Math.round((Date.now() - started) / 1000);
		report.stages.push({ name, code, seconds });
		await saveReport();
		say(`${code === 0 ? "✓" : "✗"} ${name} (${seconds}s)${code === 0 ? "" : `: see ${join(dir, `${name}.log`)}`}`);
		return { passed: code === 0, slept };
	}

	// A fast pass doesn't make a change done, so only the default and full gates record a verdict.
	const tree = tier === "fast" ? undefined : treeOf(root);
	const project = tree === undefined ? undefined : projectTreeKey(root, tree);
	// A verdict keeps a key for the stages it ran, and a full pass the key of the default stages it covered: only keys,
	// since stages' commands and environment may hold secrets. A hook counts it only while the configuration gives the
	// same stages (see verdictOf).
	const verdict = (passed, extra = {}) => {
		if (project === undefined) return;
		const key = stageKeys(root, config.gate, { create: true });
		const stages = key(tiers[tier]);
		const covers = tier === "full" && passed && ranDefault(tiers) ? { coversDefault: key(tiers.default, COVERS_DEFAULT) } : {};
		updateState(root, (state) => { state.trees[verdictKey(project, tier, stages)] = { passed, tier, stages, at: Date.now(), ...extra, ...covers }; });
	};

	/** Run `stage`, and again while it failed with the machine asleep during it: whether it passed in the end. */
	async function settle(stage) {
		let { passed, slept } = await runStage(stage);
		while (!passed && slept > 0 && !interrupted) {
			say(`  The machine slept for ${Math.round(slept / 1000)}s during ${stage.name}, so its failure says nothing about the code. Running it again.`);
			await rename(join(dir, `${stage.name}.log`), join(dir, `${stage.name}-slept.log`));
			({ passed, slept } = await runStage(stage));
		}
		return passed;
	}

	const began = Date.now();
	/** With --json, the run's report and how it ended, as the command's result: written whole before the gate exits. */
	const result = async (ended) => {
		if (json) await printJson({ ...report, logs: dir, ...ended });
	};
	say(`Gate (${tier}). Logs: ${dir}`);
	for (const group of groups(tiers[tier])) {
		// A group's stages all run to the end, so each has its log, and the gate fails at the first of them that failed.
		const results = await Promise.all(group.map(settle));
		if (interrupted) {
			say(`\nGate interrupted at ${group.map((stage) => stage.name).join(", ")}.`);
			await result({ interrupted: true });
			await exitWhenWritten(1);
		}
		const failed = group.find((_, i) => !results[i]);
		if (failed !== undefined) {
			const log = join(dir, `${failed.name}.log`);
			verdict(false, { stage: failed.name, log });
			say(`\nGate failed at ${failed.name}.`);
			const excerpt = failureExcerpt(log);
			if (excerpt) say(excerpt);
			await result({ failedAt: failed.name, log, excerpt });
			await exitWhenWritten(1);
		}
	}
	report.passed = true;
	report.completedAt = new Date().toISOString();
	await saveReport();
	// A file changed while the gate ran: what passed isn't what's there now, so the pass isn't recorded.
	if (tree !== undefined && treeOf(root) === tree) verdict(true);
	say(`\nGate passed (${Math.round((Date.now() - began) / 1000)}s).`);
	await result({ seconds: Math.round((Date.now() - began) / 1000) });
}
