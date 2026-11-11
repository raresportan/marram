// One gate for every change, so "green" means the same thing by hand, in a hook, in CI and in an agent's done-check.
// Usage: marram gate [fast | full]
//   fast      Seconds: after each edit.
//   (default) Minutes: before a task counts as done.
//   full      The default gate and more (a build, the slow journeys). Before merging UI work, or nightly.
// What each tier runs is the project's: `gate.tiers` in marram.config.mjs. Stages run in order and the first failure
// stops the gate. Each stage's output is kept in its own log under `gate.logs`/gate-<tier>-<time>/, with report.json.
// A stage that fails after the machine slept during it runs again: timeouts ran out and frames stopped while it slept,
// so that failure says nothing about the code. A pause counts as sleep past `gate.sleepGapMs`, 30 seconds by default.
// The default and full gates record their verdict for the working tree (gate-state.mjs), which the hooks reuse.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { treeOf, updateState, verdictKey } from "./gate-state.mjs";

const TIERS = ["fast", "default", "full"];

export async function gate(root, config, [tier = "default"]) {
	if (!TIERS.includes(tier)) {
		console.error(`Unknown gate "${tier}". Usage: marram gate [fast | full]`);
		process.exit(1);
	}
	const { logs, progress, tiers, sleepGapMs = 30_000 } = config.gate;
	const dir = join(root, logs, `gate-${tier}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
	await mkdir(dir, { recursive: true });
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
		const child = spawn(command, args, { cwd: root, env: { ...outsideGit, ...env }, stdio: ["ignore", "pipe", "pipe"] });
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
			child.on("error", () => done(1));
			child.on("exit", (exit) => done(exit ?? 1));
		});
		clearInterval(clock);
		noticeSleep();
		log.end();
		const seconds = Math.round((Date.now() - started) / 1000);
		report.stages.push({ name, code, seconds });
		await writeFile(join(dir, "report.json"), JSON.stringify(report, null, 2));
		console.log(`${code === 0 ? "✓" : "✗"} ${name} (${seconds}s)${code === 0 ? "" : `: see ${join(dir, `${name}.log`)}`}`);
		return { passed: code === 0, slept };
	}

	// A fast pass doesn't make a change done, so only the default and full gates record a verdict.
	const tree = tier === "fast" ? undefined : treeOf(root);
	const verdict = (passed, extra = {}) => {
		if (tree !== undefined) updateState(root, (state) => { state.trees[verdictKey(tree, tier)] = { passed, tier, at: Date.now(), ...extra }; });
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
			verdict(false, { stage: stage.name, log: join(dir, `${stage.name}.log`) });
			console.log(`\nGate failed at ${stage.name}.`);
			process.exit(1);
		}
	}
	report.passed = true;
	report.completedAt = new Date().toISOString();
	await writeFile(join(dir, "report.json"), JSON.stringify(report, null, 2));
	// A file changed while the gate ran: what passed isn't what's there now, so the pass isn't recorded.
	if (tree !== undefined && treeOf(root) === tree) verdict(true);
	console.log(`\nGate passed (${report.stages.reduce((total, stage) => total + stage.seconds, 0)}s).`);
}
