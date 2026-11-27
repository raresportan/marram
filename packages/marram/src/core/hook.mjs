// Runs the gate where work is declared done, so nothing finishes or ships while it's red. Usage:
//   marram hook pre-push      git's pre-push hook: what's pushed must have passed `gate.prePush`, the default gate
//                           unless that names "full".
//   marram hook claude-turn   Claude Code's UserPromptSubmit: notes the code a turn starts from.
//   marram hook claude-stop   Claude Code's Stop: a turn that changed code ends only once the gate passes, sent back at
//                           most 3 times a turn.
//   marram hook finish        An agent's own done-check: a failure exits 1 with what failed, so the
//                           agent is sent back as many times as its hook allows.
// Code the gate passed isn't checked again, and a failure is reused for 15 minutes; see gate-state.mjs.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { git, treeOf, updateState, verdictOf, readState } from "./gate-state.mjs";
import { failureExcerpt } from "./failure-excerpt.mjs";

const MAX_SENT_BACK = 3;
const MARRAM = join(import.meta.dirname, "..", "..", "bin", "marram.mjs");
const stdin = () => readFileSync(0, "utf8");

/**
 * `tier`'s verdict on `tree` for the stages `config` gives it now, running that gate when there is none. `show` sends its
 * progress to the terminal. The gate runs with this process's environment, so it builds the same stages.
 */
async function judge(root, config, tree, show, tier = "default") {
	const known = verdictOf(root, tree, tier, config.gate);
	if (known !== undefined) return { ...known, reused: true };
	const gate = spawn(process.execPath, [MARRAM, "gate", ...(tier === "default" ? [] : [tier])], { cwd: root, stdio: ["ignore", show ? "inherit" : "ignore", "inherit"] });
	// A hook that's killed (its timeout) passes it on, so the gate can stop what it started.
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => gate.kill(signal));
	await new Promise((done) => gate.once("close", done));
	// A gate that couldn't run, or that changed files as it ran, records no pass; it counts as failed with no stage.
	return verdictOf(root, tree, tier, config.gate) ?? { passed: false };
}

/** What an agent is told when the gate fails: where it failed, and the end of that stage's log. */
function failure(verdict) {
	if (verdict.stage === undefined) return "The gate didn't record a pass: it couldn't run, or files changed while it ran. Run `marram gate` and fix what it reports.";
	const tail = failureExcerpt(verdict.log);
	return [
		`The gate failed at ${verdict.stage}${verdict.reused ? " (the verdict on this exact code, from a run in the last 15 minutes)" : ""}, so this isn't done.`,
		"Fix the cause, not the check, then finish again. `marram gate` reruns it.",
		`Log: ${verdict.log}`,
		...(tail === "" ? [] : ["", tail]),
	].join("\n");
}

async function prePush(root, config) {
	const tier = config.gate?.prePush ?? "default";
	if (tier !== "default" && tier !== "full") {
		console.error(`gate.prePush is "${tier}": a push can require the default gate or the full one.`);
		process.exit(1);
	}
	// stdin: one line per ref pushed, "<local ref> <local sha> <remote ref> <remote sha>".
	for (const line of stdin().split("\n").filter(Boolean)) {
		const [ref, sha] = line.split(" ");
		if (/^0+$/.test(sha)) continue; // a deletion
		const tree = git(root, ["rev-parse", `${sha}^{tree}`]);
		if (verdictOf(root, tree, tier, config.gate)?.passed) continue;
		if (treeOf(root) !== tree) {
			console.error(`${ref} hasn't passed the ${tier} gate, and the working tree isn't that commit, so it can't be checked here.\nCommit or stash your changes, check it out and push again (or \`git push --no-verify\` to skip the gate).`);
			process.exit(1);
		}
		console.error(`Gating ${ref} (the ${tier} gate) before it's pushed (\`git push --no-verify\` skips this).`);
		const verdict = await judge(root, config, tree, true, tier);
		if (!verdict.passed) {
			console.error(failure(verdict));
			process.exit(1);
		}
	}
}

function claudeTurn(root) {
	const { session_id: session } = JSON.parse(stdin());
	const tree = treeOf(root);
	updateState(root, (state) => { state.sessions[session] = { start: tree, sentBack: 0, at: Date.now() }; });
}

async function claudeStop(root, config) {
	const { session_id: session } = JSON.parse(stdin());
	const tree = treeOf(root);
	const turn = readState(root).sessions[session];
	// A turn that changed no code (a question, a plan) ends without the gate.
	if (turn?.start === tree) process.exit(0);
	const verdict = await judge(root, config, tree, false);
	if (verdict.passed) process.exit(0);
	// Counted under the lock, from the state as it is now: the gate may have run for minutes since `turn` was read.
	const sendBack = updateState(root, (state) => {
		const now = state.sessions[session];
		if ((now?.sentBack ?? 0) >= MAX_SENT_BACK) return false;
		state.sessions[session] = { start: now?.start, sentBack: (now?.sentBack ?? 0) + 1, at: Date.now() };
		return true;
	});
	if (!sendBack) {
		// Let the turn end so a person can look; say so rather than end quietly.
		console.log(JSON.stringify({ systemMessage: `The gate is still red after ${MAX_SENT_BACK} tries at ${verdict.stage ?? "an unknown stage"}: ${verdict.log ?? "run marram gate"}` }));
		process.exit(0);
	}
	console.error(failure(verdict));
	process.exit(2);
}

async function finish(root, config) {
	const verdict = await judge(root, config, treeOf(root), false);
	if (!verdict.passed) {
		console.log(failure(verdict));
		process.exit(1);
	}
}

const modes = { "pre-push": prePush, "claude-turn": claudeTurn, "claude-stop": claudeStop, finish };

export async function hook(root, config, [mode]) {
	if (!(mode in modes)) {
		console.error(`Usage: marram hook ${Object.keys(modes).join(" | ")}`);
		process.exit(1);
	}
	await modes[mode](root, config);
}
