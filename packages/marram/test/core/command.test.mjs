// Spawning a project's command on each platform: a Windows .cmd goes through cmd.exe. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { test } from "node:test";
import { locate, spawnable } from "../../src/core/command.mjs";

const windows = (files, env = {}) => ({
	platform: "win32",
	env: { Path: "C:\\tools;C:\\Program Files\\nodejs", PATHEXT: ".COM;.EXE;.BAT;.CMD", ComSpec: "C:\\Windows\\system32\\cmd.exe", ...env },
	// Windows paths aren't case-sensitive: npm.CMD, from PATHEXT, is npm.cmd.
	exists: (path) => files.some((file) => file.toLowerCase() === path.toLowerCase()),
});

test("outside Windows, a command runs as given", () => {
	assert.deepEqual(spawnable("npm", ["run", "build"], { platform: "linux" }), { file: "npm", args: ["run", "build"], options: {} });
});

test("on Windows, a .cmd on PATH runs through cmd.exe with each argument quoted and escaped", () => {
	const { file, args, options } = spawnable("npm", ["run", "gate", "-w", "tally", 'say "hi" & more'], windows(["C:\\Program Files\\nodejs\\npm.cmd"]));
	assert.equal(file, "C:\\Windows\\system32\\cmd.exe");
	assert.deepEqual(options, { windowsVerbatimArguments: true });
	assert.deepEqual(args.slice(0, 3), ["/d", "/s", "/c"]);
	assert.equal(args[3], '"C:\\Program^ Files\\nodejs\\npm.CMD ^"run^" ^"gate^" ^"-w^" ^"tally^" ^"say^ \\^"hi\\^"^ ^&^ more^""');
});

test("on Windows, an npm shim in node_modules\\.bin is escaped twice, since it hands its arguments to cmd.exe again", () => {
	const shim = "C:\\repo\\node_modules\\.bin\\tsx.cmd";
	const viaPath = spawnable("tsx", ["a&b"], windows([shim], { Path: "C:\\repo\\node_modules\\.bin" }));
	assert.equal(viaPath.args[3], '"C:\\repo\\node_modules\\.bin\\tsx.CMD ^^^"a^^^&b^^^""');
});

test("on Windows, a program (.exe) runs as given, and so does a command it can't find", () => {
	assert.deepEqual(spawnable("node", ["x.mjs"], windows(["C:\\tools\\node.EXE"])), { file: "node", args: ["x.mjs"], options: {} });
	assert.deepEqual(spawnable("missing", [], windows([])), { file: "missing", args: [], options: {} });
});

test("on Windows, a command named with its extension, or by path, is found as named", () => {
	assert.equal(spawnable("build.bat", [], windows(["C:\\tools\\build.bat"])).file, "C:\\Windows\\system32\\cmd.exe");
});

test("on Windows, a command given by path is found from the folder it runs in, and named with backslashes", () => {
	const project = { ...windows(["C:\\repo\\app\\scripts\\check.cmd"]), cwd: "C:\\repo\\app" };
	assert.equal(spawnable("scripts\\check", [], project).args[3].toLowerCase(), '"c:\\repo\\app\\scripts\\check.cmd"');
	// Written for every platform, with forward slashes, which cmd.exe would read as a switch.
	assert.equal(spawnable("scripts/check.cmd", [], project).args[3].toLowerCase(), '"c:\\repo\\app\\scripts\\check.cmd"');
	assert.equal(spawnable("./scripts/check", [], project).args[3].toLowerCase(), '"c:\\repo\\app\\scripts\\check.cmd"');
});

test("a command is found on PATH, or as a path from the folder it runs in, or not at all", () => {
	const unix = (files, env = {}) => ({ platform: "linux", cwd: "/repo", env: { PATH: "/usr/bin:/opt/node/bin", ...env }, exists: (path) => files.includes(path) });
	assert.equal(locate("npm", unix(["/opt/node/bin/npm"])), "/opt/node/bin/npm");
	assert.equal(locate("scripts/check", unix(["/repo/scripts/check"])), "/repo/scripts/check");
	assert.equal(locate("./check", unix(["/usr/bin/check"])), undefined);
	assert.equal(locate("missing", unix([])), undefined);
	assert.equal(locate("npm", windows(["C:\\Program Files\\nodejs\\npm.cmd"])).toLowerCase(), "c:\\program files\\nodejs\\npm.cmd");
	assert.equal(locate("missing", windows([])), undefined);
});
