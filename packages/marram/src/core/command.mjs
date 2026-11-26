// A project's command (a gate stage, a probe's check, replay's setup) as spawn can run it on this platform. On Windows,
// npm, npx and other commands installed as .cmd or .bat scripts can't be spawned directly: Node refuses them without a
// shell. They run through cmd.exe instead, with the command and each argument quoted and escaped for it, as the
// cross-spawn package does. Elsewhere, and for a Windows program (.exe, .com), the command runs as given.
import { existsSync } from "node:fs";
import { win32 } from "node:path";

// The characters cmd.exe treats specially, escaped with ^ so it passes them on.
const META = /([()\][%!^"`<>&|;, *?])/g;

/**
 * `{ file, args, options }` to spawn `command` with `args` from `cwd`, which a command given by path is found from.
 * `platform`, `env` (for PATH, PATHEXT and ComSpec) and `exists` are this process's unless given.
 */
export function spawnable(command, args, { cwd = process.cwd(), platform = process.platform, env = process.env, exists = existsSync } = {}) {
	if (platform !== "win32") return { file: command, args, options: {} };
	// With backslashes: cmd.exe reads a / in the command's name as the start of a switch.
	const found = onPath(command, cwd, env, exists);
	if (found === undefined || !/\.(cmd|bat)$/i.test(found)) return { file: command, args, options: {} };
	// npm's shims in node_modules\.bin hand their arguments to cmd.exe a second time, so they're escaped twice there.
	const twice = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(found);
	const line = [found.replace(META, "^$1"), ...args.map((arg) => quoted(arg, twice))].join(" ");
	const shell = variable(env, "ComSpec") ?? "cmd.exe";
	return { file: shell, args: ["/d", "/s", "/c", `"${line}"`], options: { windowsVerbatimArguments: true } };
}

/** `arg` quoted as Windows programs read their command line, then escaped for cmd.exe (`twice` for a second reading). */
function quoted(arg, twice) {
	// Backslashes before a quote, or at the end, are doubled so they stay literal; quotes are escaped.
	const argv = `"${String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
	const once = argv.replace(META, "^$1");
	return twice ? once.replace(META, "^$1") : once;
}

/** An environment variable by its name in any case, as Windows looks them up. */
function variable(env, name) {
	const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
	return key === undefined ? undefined : env[key];
}

/**
 * The file Windows would run for `command`, as a whole path: on PATH, or given as a path from `cwd`, with each of
 * PATHEXT's extensions tried.
 */
function onPath(command, cwd, env, exists) {
	const extensions = (variable(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
	const named = extensions.some((extension) => command.toLowerCase().endsWith(extension.toLowerCase())) ? [command] : [];
	const candidates = (base) => [...named.map(() => base), ...extensions.map((extension) => base + extension)];
	const folders = /[\\/]/.test(command) || win32.isAbsolute(command) ? [cwd] : (variable(env, "PATH") ?? "").split(";").filter(Boolean);
	for (const folder of folders) {
		for (const candidate of candidates(win32.resolve(folder, command))) if (exists(candidate)) return candidate;
	}
	return undefined;
}
