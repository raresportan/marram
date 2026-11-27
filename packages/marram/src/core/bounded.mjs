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

const GRACE_MS = 5_000;
const WINDOWS = process.platform === "win32";

/**
 * Run `file` with `args` for at most `timeout` ms: `{ status, signal, error?, stdout, stderr }`, as spawnSync gives it,
 * with `error.code` "ETIMEDOUT" when it was stopped at the timeout. `capture` collects its output as text; otherwise
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
	return { status: report.status, signal: report.signal, ...output };
}

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
	let timedOut = false;
	let interrupted = false;
	let ended;
	let finished = false;
	const finish = () => {
		if (finished) return;
		finished = true;
		clearTimeout(timer);
		report({ status: ended?.status ?? null, signal: ended?.signal ?? null, timedOut });
		// What it forwarded is written before the supervisor goes: to a pipe, a write can finish later.
		process.stdout.write("", () => process.stderr.write("", () => process.exit(0)));
	};
	/** Stop the command and what it started; once it's gone and nothing it can reach is left, let go of its output. */
	const halt = (signal) => {
		stop(signal);
		setTimeout(() => stop("SIGKILL"), GRACE_MS);
		const poll = setInterval(() => {
			if (ended === undefined || groupAlive()) return;
			clearInterval(poll);
			// Whatever still holds the output is out of reach (a group of its own): the caller doesn't wait for it.
			child.stdout?.destroy();
			child.stderr?.destroy();
			finish();
		}, 50);
	};
	const timer = setTimeout(() => {
		timedOut = true;
		halt("SIGTERM");
	}, timeout);
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
		process.on(signal, () => {
			interrupted = true;
			halt(signal);
		});
	}
	child.on("error", (error) => {
		clearTimeout(timer);
		report({ error: { code: error.code, message: error.message } });
		process.exit(0);
	});
	child.on("exit", (status, signal) => {
		ended = { status, signal };
	});
	// Exited, and its output let go by everything that held it: done.
	child.on("close", finish);
}

if (process.argv[1] === import.meta.filename && process.argv[2] === "--supervise") supervise(JSON.parse(readFileSync(0, "utf8")));
