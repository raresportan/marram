// A project's command run for at most a given time, synchronously, for replay's setup, a probe's check and a node:test
// run. spawnSync's own timeout sends one SIGTERM and then waits however long the command takes: one that handles
// SIGTERM and carries on, or leaves a process holding its output open, would hang the caller past its timeout.
//
// So the command runs under a supervisor (this file, run as a script), in a process group of its own. At the timeout
// the supervisor sends the group SIGTERM, so the command can stop what it started, and after GRACE_MS SIGKILL; on
// Windows, taskkill ends the command's whole tree. An interruption (Ctrl-C, a hook's timeout) is passed on to the
// group, which no longer gets the terminal's own. The supervisor says how the command ended on file descriptor 3.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeSync } from "node:fs";

const GRACE_MS = 5_000;
const WINDOWS = process.platform === "win32";

/**
 * Run `file` with `args` for at most `timeout` ms: `{ status, signal, error?, stdout, stderr }`, as spawnSync gives it,
 * with `error.code` "ETIMEDOUT" when it was stopped at the timeout. `capture` collects its output as text; otherwise
 * it goes to this process's stderr. `options` are spawn's (cwd, env, windowsVerbatimArguments).
 */
export function runBounded(file, args, { timeout, capture = false, ...options }) {
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
	const child = spawn(file, args, { ...options, stdio: ["ignore", "inherit", "inherit"], detached: !WINDOWS });
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
	let timedOut = false;
	let interrupted = false;
	const timer = setTimeout(() => {
		timedOut = true;
		stop("SIGTERM");
		setTimeout(() => stop("SIGKILL"), GRACE_MS).unref();
	}, timeout);
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
		process.on(signal, () => {
			interrupted = true;
			stop(signal);
			setTimeout(() => stop("SIGKILL"), GRACE_MS).unref();
		});
	}
	child.on("error", (error) => {
		clearTimeout(timer);
		report({ error: { code: error.code, message: error.message } });
		process.exit(0);
	});
	child.on("exit", (status, signal) => {
		clearTimeout(timer);
		// What the command started and left running, after a timeout or an interruption, would keep its output open and
		// the caller waiting.
		if (timedOut || interrupted) stop("SIGKILL");
		report({ status, signal, timedOut });
		process.exit(0);
	});
}

if (process.argv[1] === import.meta.filename && process.argv[2] === "--supervise") supervise(JSON.parse(readFileSync(0, "utf8")));
