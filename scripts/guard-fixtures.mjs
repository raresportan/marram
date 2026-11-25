// Exercise each guard twice in a disposable project. A different failure makes the experiment inconclusive.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "marram-guard-fixtures-"));
const tally = join(scratch, "examples/tally");
// Tally's build and journeys can take minutes on a cold CI machine.
const TIMEOUT_MS = Number(process.env.GUARD_FIXTURES_TIMEOUT_MS) || 300_000;
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		rmSync(scratch, { recursive: true, force: true });
		process.exit(128 + (signal === "SIGINT" ? 2 : 15));
	});
}

function run(cwd, [command, ...args], expected) {
	const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: TIMEOUT_MS });
	const output = result.stdout + result.stderr;
	if (result.error || result.status === null || (expected ? result.status === 0 || !expected.test(output) : result.status !== 0)) {
		throw new Error(`${command} ${args.join(" ")}: ${result.error?.message ?? "unexpected outcome"}\n${output}`);
	}
}

function probe({ name, cwd, command, file, from, to, expected }) {
	const start = Date.now();
	run(cwd, command);
	const path = join(scratch, file);
	const clean = readFileSync(path, "utf8");
	if (clean.split(from).length !== 2) throw new Error(`${name}: fixture no longer matches exactly once in ${file}`);
	writeFileSync(path, clean.replace(from, to));
	try {
		run(cwd, command, expected);
		console.log(`✓ ${name}: clean control passed, fault detected (${Date.now() - start} ms)`);
	} finally {
		writeFileSync(path, clean);
	}
}

try {
	for (const path of ["tsconfig.base.json", "packages/marram", "examples/tally"]) {
		cpSync(join(root, path), join(scratch, path), { recursive: true, filter: (file) => !["node_modules", ".verify", "out"].includes(basename(file)) });
	}
	const deps = join(scratch, "node_modules");
	mkdirSync(join(deps, "@raresportan"), { recursive: true });
	for (const entry of readdirSync(join(root, "node_modules"))) {
		if (entry !== "@raresportan" && entry !== ".bin") symlinkSync(join(root, "node_modules", entry), join(deps, entry));
	}
	// The same relative links, so a command such as `marram` runs the copy under test, not the original.
	mkdirSync(join(deps, ".bin"));
	for (const entry of readdirSync(join(root, "node_modules/.bin"))) {
		symlinkSync(readlinkSync(join(root, "node_modules/.bin", entry)), join(deps, ".bin", entry));
	}
	symlinkSync(join(scratch, "packages/marram"), join(deps, "@raresportan/marram"));
	probe({
		name: "nested projects must run their own gate", cwd: scratch,
		command: [process.execPath, "--test", "--test-name-pattern=nested project's full pass", "packages/marram/test/core/hook.test.mjs"],
		file: "packages/marram/src/core/gate-state.mjs",
		from: 'JSON.stringify([git(cwd, ["rev-parse", "--show-prefix"]), tree])', to: "tree",
		expected: /finish must run the root project's stage/,
	});
	probe({
		name: "an IPC operation requires a host handler", cwd: tally, command: ["npm", "run", "typecheck"],
		file: "examples/tally/src/features/counter/host/index.ts", from: "\t\tincrement: () => store.increment(),\n", to: "",
		expected: /error TS2345:[\s\S]*Property 'increment' is missing/,
	});
	run(tally, ["npm", "run", "build"]);
	probe({
		name: "the counting journey must observe persistence after restart", cwd: tally, command: ["npm", "run", "verify"],
		file: "examples/tally/scripts/verify/journeys.ts",
		from: "\tawait session.close();",
		to: '}\n\nexport async function checkRestart(session: Session): Promise<void> {\n\tconst button = () => session.page.getByRole("button", { name: /Count/ });\n\tawait session.close();',
		expected: /expected counts › "The count survives a restart"\. Passed checks: It starts at zero, One click counts one/,
	});
	console.log("3/3 faults detected by their intended guards");
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
