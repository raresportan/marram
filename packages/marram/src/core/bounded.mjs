// A project's command run for at most a given time, synchronously, for replay's setup, a probe's check and a node:test
// run. spawnSync's own timeout sends one SIGTERM and then waits however long the command takes: one that handles
// SIGTERM and carries on, or leaves a process holding its output open, would hang the caller past its timeout.
//
// So the command runs under a supervisor (this file, run as a script), in a process group of its own. At the timeout
// the supervisor sends the group SIGTERM, so the command can stop what it started, and after GRACE_MS SIGKILL; on
// Windows, taskkill ends the command's whole tree. An interruption (Ctrl-C, a hook's timeout) is passed on to the
// group, which no longer gets the terminal's own. The command's output comes through the supervisor, so a command is
// done when it has exited and everything holding its output has let go, and the timeout covers all of that: whatever
// still holds it at the deadline, even out of reach in a group of its own, doesn't hold the caller. The supervisor says
// how the command ended on file descriptor 3.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeSync } from "node:fs";
import { exitWhenWritten } from "./json-output.mjs";
import { machine } from "./machine.mjs";

const GRACE_MS = 5_000;
const WINDOWS = process.platform === "win32";

/**
 * Run `file` with `args` for at most `timeout` ms: `{ status, signal, error?, stdout, stderr }`, as spawnSync gives it,
 * with `error.code` "ETIMEDOUT" when it was stopped at the timeout, and "EINTR" when this process was interrupted
 * before then. `capture` collects its output as text; otherwise
 * it goes to this process's stderr, and `terminal` says whether that's a terminal. `options` are spawn's (cwd, env,
 * windowsVerbatimArguments).
 */
export function runBounded(file, args, { timeout, capture = false, terminal = Boolean(process.stderr.isTTY), ...options }) {
	// Through the supervisor the command's output is a pipe, so a command that colours only for a terminal wouldn't:
	// where it ends up on one, it's told to, unless the project's env already says either way.
	const env = options.env ?? process.env;
	if (!capture && terminal && env.FORCE_COLOR === undefined && env.NO_COLOR === undefined) options = { ...options, env: { ...env, FORCE_COLOR: "1" } };
	// On stdin rather than the command line, where `ps` would show an env's values (secrets, say) and Windows limits
	// the length.
	const spec = JSON.stringify({ file, args, timeout, options });
	const supervisor = spawnSync(process.execPath, [import.meta.filename, "--supervise"], {
		cwd: options.cwd,
		encoding: "utf8",
		input: spec,
		maxBuffer: 64 * 1024 * 1024,
		stdio: ["pipe", capture ? "pipe" : 2, capture ? "pipe" : 2, "pipe"],
		// Only if the supervisor itself never returns.
		timeout: timeout + GRACE_MS + 30_000,
		killSignal: "SIGKILL",
	});
	const output = { stdout: supervisor.stdout ?? "", stderr: supervisor.stderr ?? "" };
	let report;
	try {
		report = JSON.parse(supervisor.output?.[3] || "null");
	} catch {
		report = null;
	}
	if (report === null) return { status: null, signal: supervisor.signal, error: supervisor.error ?? new Error("the command's supervisor didn't say how it ended"), ...output };
	if (report.error) return { status: null, signal: null, error: Object.assign(new Error(report.error.message), { code: report.error.code }), ...output };
	if (report.timedOut) return { status: report.status, signal: report.signal, error: Object.assign(new Error(`didn't finish within ${timeout} ms`), { code: "ETIMEDOUT" }), ...output };
	// An interruption is the result, whatever status the command exited with as it cleaned up.
	if (report.interrupted) return { status: report.status, signal: report.signal, error: Object.assign(new Error(`interrupted by ${report.interrupted}`), { code: "EINTR" }), ...output };
	return { status: report.status, signal: report.signal, ...output };
}

/**
 * The supervisor's lifecycle: for each state, the state each event leads to.
 *   exit       the command exited (with its status and signal)
 *   close      the command exited, and everything that held its output let go of it
 *   deadline   its timeout came
 *   interrupt  the supervisor was signalled (Ctrl-C, a hook's timeout)
 *   drained    while halting: the command is gone, and nothing it can be signalled through is left
 *   grace      while halting: GRACE_MS passed since the first signal
 *   error      it couldn't be started
 * Every event is listed in every state, so one ignored is a choice: once it has reported (done, failed), nothing more
 * is, so a close that follows a spawn error, or a deadline that follows a close, can't report twice.
 */
export const LIFECYCLE = {
	// Running, holding its output.
	running: { exit: "exited", close: "done", deadline: "halting", interrupt: "halting", drained: "running", grace: "running", error: "failed" },
	// Exited, while something it started may still hold its output: the timeout still covers that.
	exited: { exit: "exited", close: "done", deadline: "halting", interrupt: "halting", drained: "exited", grace: "exited", error: "exited" },
	// Stopped at its timeout or on an interruption: its group was signalled, SIGKILL follows at grace, and once drained,
	// whatever still holds its output is out of reach and the caller doesn't wait for it.
	halting: { exit: "halting", close: "done", deadline: "halting", interrupt: "halting", drained: "done", grace: "halting", error: "failed" },
	// Said how it ended.
	done: { exit: "done", close: "done", deadline: "done", interrupt: "done", drained: "done", grace: "done", error: "done" },
	// Said why it couldn't start.
	failed: { exit: "failed", close: "failed", deadline: "failed", interrupt: "failed", drained: "failed", grace: "failed", error: "failed" },
};

/** The supervisor: runs the command `spec` names, stops it at its timeout, and reports how it ended. */
function supervise({ file, args, timeout, options }) {
	const report = (value) => writeSync(3, JSON.stringify(value));
	// The command's output comes through here rather than straight to the caller: then the supervisor knows when the last
	// process holding it lets it go (the command, or anything it started, in its group or not), and at the deadline it can
	// let the caller go, whoever still holds it.
	const child = spawn(file, args, { ...options, stdio: ["ignore", "pipe", "pipe"], detached: !WINDOWS });
	child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
	child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
	/** Send `signal` to the command and everything it started. */
	const stop = (signal) => {
		if (child.pid === undefined) return;
		if (WINDOWS) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
		else {
			try {
				process.kill(-child.pid, signal);
			} catch {
				// The group is gone already.
			}
		}
	};
	/** Whether anything is left in the command's process group, which it can be signalled through. */
	const groupAlive = () => {
		if (WINDOWS) return false;
		try {
			process.kill(-child.pid, 0);
			return true;
		} catch (error) {
			return error.code === "EPERM";
		}
	};
	// What the moves found out, for the report: how the command ended, whether it was stopped at its timeout, and the
	// first interruption, which stands whatever the command does after it: one that cleans up and exits 0 still didn't
	// run its course.
	const found = { ended: undefined, timedOut: false, interrupted: undefined };
	const timers = [];
	const lifecycle = machine(LIFECYCLE, "running", ({ event, from, to, args: [first, second] }) => {
		if (event === "exit") found.ended = { status: first, signal: second };
		if (event === "interrupt" && found.interrupted === undefined && from !== "done" && from !== "failed") found.interrupted = first;
		if (to === "halting" && from !== "halting") {
			found.timedOut = event === "deadline";
			stop(event === "deadline" ? "SIGTERM" : first);
			timers.push(setTimeout(() => lifecycle.send("grace"), GRACE_MS));
			timers.push(setInterval(() => {
				if (found.ended !== undefined && !groupAlive()) lifecycle.send("drained");
			}, 50));
		}
		// A second interruption is passed on too, with no second grace period.
		if (event === "interrupt" && from === "halting") stop(first);
		if (event === "grace" && to === "halting") stop("SIGKILL");
		if (to === from) return;
		if (to === "done" || to === "failed") for (const timer of timers) clearTimeout(timer);
		if (to === "done" && event === "drained") {
			// Whatever still holds the output is out of reach (a group of its own): the caller doesn't wait for it.
			child.stdout?.destroy();
			child.stderr?.destroy();
		}
		if (to === "done") report({ status: found.ended?.status ?? null, signal: found.ended?.signal ?? null, timedOut: found.timedOut, interrupted: found.interrupted });
		if (to === "failed") report({ error: { code: first.code, message: first.message } });
		// What it forwarded is written before the supervisor goes: to a pipe, a write can finish later.
		if (to === "done" || to === "failed") exitWhenWritten(0);
	});
	timers.push(setTimeout(() => lifecycle.send("deadline"), timeout));
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => lifecycle.send("interrupt", signal));
	child.on("error", (error) => lifecycle.send("error", error));
	child.on("exit", (status, signal) => lifecycle.send("exit", status, signal));
	child.on("close", () => lifecycle.send("close"));
}

if (process.argv[1] === import.meta.filename && process.argv[2] === "--supervise") supervise(JSON.parse(readFileSync(0, "utf8")));
