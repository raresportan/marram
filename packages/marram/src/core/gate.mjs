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
import { createWriteStream, rmSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectTreeKey, treeOf, updateState, verdictKey } from "./gate-state.mjs";
import { spawnable } from "./command.mjs";
import { failureExcerpt } from "./failure-excerpt.mjs";

const TIERS = ["fast", "default", "full"];
// A run's folder: its tier, when it started, and its gate's process id, so two gates starting in the same millisecond
// don't share one. Folders from before the id was added match too, so they're still pruned.
const RUN = /^gate-(?:fast|default|full)-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z)(?:-\d+)?$/;
// A run's folder while it's being made (see startRun), named for the gate making it.
const STARTING = /^\.gate-(?:fast|default|full)-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-(\d+)$/;

// A run's folder holds this while its gate runs: the gate's process id, so pruning leaves the folder of a run that's
// still going (another gate, in another terminal or hook) and takes one whose gate is gone.
const RUNNING = "running";

/** Whether the process `pid` is still running. */
function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}

/**
 * Whether the run in `folder` may still be going: its marker names a process that's running, or the marker is there but
 * can't be read (EACCES, say), so whether it's going isn't known. Only a missing or malformed marker says it's over.
 */
async function stillGoing(folder) {
	let text;
	try {
		text = await readFile(join(folder, RUNNING), "utf8");
	} catch (error) {
		return error.code !== "ENOENT";
	}
	const pid = Number(text);
	return Number.isSafeInteger(pid) && pid > 0 && alive(pid);
}

/**
 * Removes all but the newest `keep` of the gate's run folders in `logs`, whatever their tier, except a run that may still
 * be going; and a folder a gate was making when it died. Only the gate's own folders (gate-<tier>-<time>, and
 * .gate-<tier>-<time>-<pid> while one is made) are touched: anything else a project keeps there stays.
 */
export async function pruneLogs(logs, keep) {
	const entries = (await readdir(logs, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory());
	const runs = entries
		.filter((entry) => RUN.test(entry.name))
		.map((entry) => ({ name: entry.name, time: RUN.exec(entry.name)[1] }))
		.sort((a, b) => b.time.localeCompare(a.time) || b.name.localeCompare(a.name));
	const abandoned = entries.filter((entry) => STARTING.test(entry.name) && !alive(Number(STARTING.exec(entry.name)[1])));
	await Promise.all([
		...runs.slice(keep).map(async ({ name }) => {
			const folder = join(logs, name);
			if (!(await stillGoing(folder))) await rm(folder, { recursive: true, force: true });
		}),
		...abandoned.map((entry) => rm(join(logs, entry.name), { recursive: true, force: true })),
	]);
}

/**
 * A new run's folder in `logs`, for `tier`, started at `date`, marked as this process's while it runs. It's made under a
 * name pruning keeps clear of while this process lives, and renamed once marked, so another gate pruning at that moment
 * can't take it unmarked. If that fails, what was made goes.
 */
export async function startRun(logs, tier, date = new Date()) {
	const name = `gate-${tier}-${date.toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
	const starting = join(logs, `.${name}`);
	const dir = join(logs, name);
	try {
		await mkdir(starting, { recursive: true });
		await writeFile(join(starting, RUNNING), String(process.pid));
		await rename(starting, dir);
	} catch (error) {
		await rm(starting, { recursive: true, force: true });
		throw error;
	}
	// However the gate ends (a pass, a failure's exit, an interruption), the run is no longer going.
	process.once("exit", () => rmSync(join(dir, RUNNING), { force: true }));
	return dir;
}

/**
 * Whether the full tier runs each default stage, in order, with the same command, arguments and environment; other
 * stages may come between them. Tiers are the project's, so a full gate needn't contain the default one, and its pass
 * then says nothing about the default gate. Only this answer is kept, not the stages: their env may hold secrets.
 */
function ranDefault(tiers) {
	if (!Array.isArray(tiers.default)) return false;
	const runs = ({ run, env = {} }) => JSON.stringify([run, Object.entries(env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))]);
	const wanted = tiers.default.map(runs);
	let found = 0;
	for (const stage of tiers.full.map(runs)) if (stage === wanted[found]) found++;
	return found === wanted.length;
}

export async function gate(root, config, [tier = "default"]) {
	if (!TIERS.includes(tier)) {
		console.error(`Unknown gate "${tier}". Usage: marram gate [fast | full]`);
		process.exit(1);
	}
	const { logs = ".verify", keep = 20, progress, tiers, sleepGapMs = 30_000 } = config.gate ?? {};
	if (!Array.isArray(tiers?.[tier])) {
		console.error(`marram.config.mjs has no gate.tiers.${tier}: a list of stages.`);
		process.exit(1);
	}
	const dir = await startRun(join(root, logs), tier);
	await pruneLogs(join(root, logs), keep);
	const report = { tier, startedAt: new Date().toISOString(), stages: [], passed: false };

	// A git hook (pre-push) runs with GIT_DIR and the like pointing at this repository; checks that make their own scratch
	// repositories would act on this one instead.
	const outsideGit = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

	// Interrupted (Ctrl-C, a hook's timeout), the gate passes the signal to the stage it runs, so a check runner can stop
	// what it started, and records no verdict: an interrupted gate says nothing about the code.
	let running;
	let interrupted = false;
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
		process.once(signal, () => {
			interrupted = true;
			running?.kill(signal);
		});
	}

	async function runStage({ name, run: [command, ...args], env = {} }) {
		const started = Date.now();
		const log = createWriteStream(join(dir, `${name}.log`));
		const stageEnv = { ...outsideGit, ...env };
		const run = spawnable(command, args, { cwd: root, env: stageEnv });
		const child = spawn(run.file, run.args, { ...run.options, cwd: root, env: stageEnv, stdio: ["ignore", "pipe", "pipe"] });
		running = child;
		child.stdout.pipe(log, { end: false });
		child.stderr.pipe(log, { end: false });
		// Progress lines (a check's ✓ or ✗, and what the project's `progress` matches); everything else stays in the log.
		child.stdout.on("data", (chunk) => {
			for (const line of chunk.toString().split("\n")) if (/^\s*[✓✗]/.test(line) || progress?.test(line)) console.log(`  ${name}: ${line.trim()}`);
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
		clearInterval(clock);
		noticeSleep();
		await new Promise((done) => log.end(done));
		const seconds = Math.round((Date.now() - started) / 1000);
		report.stages.push({ name, code, seconds });
		await writeFile(join(dir, "report.json"), JSON.stringify(report, null, 2));
		console.log(`${code === 0 ? "✓" : "✗"} ${name} (${seconds}s)${code === 0 ? "" : `: see ${join(dir, `${name}.log`)}`}`);
		return { passed: code === 0, slept };
	}

	// A fast pass doesn't make a change done, so only the default and full gates record a verdict.
	const tree = tier === "fast" ? undefined : treeOf(root);
	const project = tree === undefined ? undefined : projectTreeKey(root, tree);
	const verdict = (passed, extra = {}) => {
		if (project !== undefined) updateState(root, (state) => { state.trees[verdictKey(project, tier)] = { passed, tier, at: Date.now(), ...extra }; });
	};

	console.log(`Gate (${tier}). Logs: ${dir}`);
	for (const stage of tiers[tier]) {
		let { passed, slept } = await runStage(stage);
		while (!passed && slept > 0 && !interrupted) {
			console.log(`  The machine slept for ${Math.round(slept / 1000)}s during ${stage.name}, so its failure says nothing about the code. Running it again.`);
			await rename(join(dir, `${stage.name}.log`), join(dir, `${stage.name}-slept.log`));
			({ passed, slept } = await runStage(stage));
		}
		if (interrupted) {
			console.log(`\nGate interrupted at ${stage.name}.`);
			process.exit(1);
		}
		if (!passed) {
			const log = join(dir, `${stage.name}.log`);
			verdict(false, { stage: stage.name, log });
			console.log(`\nGate failed at ${stage.name}.`);
			const excerpt = failureExcerpt(log);
			if (excerpt) console.log(excerpt);
			process.exit(1);
		}
	}
	report.passed = true;
	report.completedAt = new Date().toISOString();
	await writeFile(join(dir, "report.json"), JSON.stringify(report, null, 2));
	// A file changed while the gate ran: what passed isn't what's there now, so the pass isn't recorded.
	if (tree !== undefined && treeOf(root) === tree) verdict(true, tier === "full" ? { coversDefault: ranDefault(tiers) } : {});
	console.log(`\nGate passed (${report.stages.reduce((total, stage) => total + stage.seconds, 0)}s).`);
}
