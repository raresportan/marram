// marram init sets a project up without touching what's there, and marram doctor names what's missing or wrong.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PKG = fileURLToPath(new URL("../..", import.meta.url));
const BIN = join(PKG, "bin", "marram.mjs");

/** A Git repository in a temporary folder, read with no global or system git config, and a way to run Marram in it. */
function repository() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "marram-setup-")));
	const empty = join(root, "..", `${root.split(/[\\/]/).at(-1)}.gitconfig`);
	writeFileSync(empty, "");
	const env = { ...process.env, GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_NOSYSTEM: "1" };
	const git = (...args) => spawnSync("git", args, { cwd: root, env, encoding: "utf8" }).stdout.trim();
	git("init", "-q");
	const marram = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: "utf8" });
	/** Marram installed as a project installs it, in node_modules at `folder`. */
	const install = (folder = root) => {
		mkdirSync(join(folder, "node_modules", "@raresportan"), { recursive: true });
		symlinkSync(PKG, join(folder, "node_modules", "@raresportan", "marram"), "junction");
	};
	const remove = () => {
		rmSync(root, { recursive: true, force: true });
		rmSync(empty, { force: true });
	};
	return { root, git, marram, install, remove };
}

test("init writes the config from package.json's scripts, ignores the logs, and installs a pre-push hook; a second run changes nothing", () => {
	const repo = repository();
	try {
		writeFileSync(join(repo.root, "package.json"), JSON.stringify({ scripts: { typecheck: "tsc", test: "node --test", build: "x" } }));
		repo.install();
		const first = repo.marram(repo.root, "init");
		assert.equal(first.status, 0, first.stderr);
		const config = readFileSync(join(repo.root, "marram.config.mjs"), "utf8");
		assert.match(config, /const fast = \[npm\("typecheck"\)\];/);
		assert.match(config, /const checks = \[\.\.\.fast, npm\("test"\)\];/);
		assert.match(readFileSync(join(repo.root, ".gitignore"), "utf8"), /^\.verify\/$/m);
		assert.equal(repo.git("config", "core.hooksPath"), ".githooks");
		const hook = join(repo.root, ".githooks", "pre-push");
		assert.equal(readFileSync(hook, "utf8"), '#!/bin/sh\nexec node "$(git rev-parse --show-toplevel)/node_modules/@raresportan/marram/bin/marram.mjs" hook pre-push\n');
		if (process.platform !== "win32") assert.equal(statSync(hook).mode & 0o111, 0o111);

		writeFileSync(join(repo.root, "marram.config.mjs"), config + "// mine\n");
		const second = repo.marram(repo.root, "init");
		assert.match(second.stdout, /marram\.config\.mjs is already there/);
		assert.match(second.stdout, /\.githooks\/pre-push already gates a push/);
		assert.doesNotMatch(second.stdout, /\.gitignore/);
		assert.match(readFileSync(join(repo.root, "marram.config.mjs"), "utf8"), /\/\/ mine/);

		const doctor = repo.marram(repo.root, "doctor");
		assert.equal(doctor.status, 0, doctor.stdout);
		assert.match(doctor.stdout, /✓ \.githooks\/pre-push gates a push/);
		assert.match(doctor.stdout, /Nothing to fix/);
	} finally {
		repo.remove();
	}
});

test("without scripts to go by, init leaves the tiers empty, and doctor says the gate checks nothing", () => {
	const repo = repository();
	try {
		repo.install();
		assert.equal(repo.marram(repo.root, "init").status, 0);
		assert.match(readFileSync(join(repo.root, "marram.config.mjs"), "utf8"), /tiers: \{ fast: \[\], default: \[\], full: \[\] \}/);
		const doctor = repo.marram(repo.root, "doctor");
		assert.equal(doctor.status, 1);
		assert.match(doctor.stdout, /! gate\.tiers\.fast runs nothing: `marram gate fast` passes without checking anything/);
		assert.match(doctor.stdout, /✗ gate\.tiers\.default runs nothing: `marram gate` passes without checking anything/);
		assert.match(doctor.stdout, /1 problem\(s\) to fix/);
	} finally {
		repo.remove();
	}
});

test("init leaves core.hooksPath alone when git already runs hooks of its own", () => {
	const repo = repository();
	try {
		const own = join(repo.root, ".git", "hooks", "pre-commit");
		writeFileSync(own, "#!/bin/sh\n");
		const result = repo.marram(repo.root, "init");
		assert.match(result.stdout, /git runs hooks from .* \(pre-commit\), so core\.hooksPath is left unset/);
		assert.equal(repo.git("config", "core.hooksPath"), "");
		assert.ok(!existsSync(join(repo.root, ".githooks")));
		assert.match(repo.marram(repo.root, "doctor").stdout, /✗ No pre-push hook in \.git\/hooks \(core\.hooksPath isn't set\) runs `marram hook pre-push`/);
	} finally {
		repo.remove();
	}
});

test("a project in a folder of the repository gets a hook that gates it from its folder, with Marram from its node_modules", () => {
	const repo = repository();
	try {
		const app = join(repo.root, "app");
		mkdirSync(app);
		writeFileSync(join(app, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
		repo.install(app);
		const result = repo.marram(app, "init");
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readFileSync(join(repo.root, ".githooks", "pre-push"), "utf8"), '#!/bin/sh\ncd "$(git rev-parse --show-toplevel)/app" || exit 1\nexec node "$(git rev-parse --show-toplevel)/app/node_modules/@raresportan/marram/bin/marram.mjs" hook pre-push\n');
		assert.match(readFileSync(join(app, ".gitignore"), "utf8"), /^\.verify\/$/m);
		const doctor = repo.marram(app, "doctor");
		assert.equal(doctor.status, 0, doctor.stdout);
		assert.match(doctor.stdout, /✓ \.githooks\/pre-push gates a push/);
		// Installed at the top instead, the hook still names app's, which isn't there.
		rmSync(join(app, "node_modules"), { recursive: true });
		repo.install();
		const moved = repo.marram(app, "doctor");
		assert.equal(moved.status, 1);
		assert.match(moved.stdout, /✗ \.githooks\/pre-push runs app\/node_modules\/@raresportan\/marram\/bin\/marram\.mjs, which isn't installed/);
		assert.doesNotMatch(moved.stdout, /✓ \.githooks\/pre-push/);
	} finally {
		repo.remove();
	}
});

test("init says when Marram isn't installed yet, and doctor that the hook can't run", () => {
	const repo = repository();
	try {
		assert.match(repo.marram(repo.root, "init").stdout, /Marram isn't installed here yet/);
		assert.match(repo.marram(repo.root, "doctor").stdout, /✗ \.githooks\/pre-push runs node_modules\/@raresportan\/marram\/bin\/marram\.mjs, which isn't installed: `npm install`/);
	} finally {
		repo.remove();
	}
});

test("doctor names each problem in the setup, with what to do about it", () => {
	const repo = repository();
	try {
		assert.match(repo.marram(repo.root, "doctor").stdout, /✗ No marram\.config\.mjs in .* or above it: `marram init` writes one/);

		writeFileSync(join(repo.root, "marram.config.mjs"), 'export default { gate: { tiers: { defualt: [] } } };');
		const invalid = repo.marram(repo.root, "doctor");
		assert.equal(invalid.status, 1);
		assert.match(invalid.stdout, /✗ marram\.config\.mjs: gate\.tiers\.defualt isn't something Marram reads: did you mean gate\.tiers\.default\?/);

		repo.install();
		writeFileSync(join(repo.root, "marram.config.mjs"), [
			'const tests = [{ name: "tests", run: ["no-such-command-here", "x"] }, { name: "more", run: ["no-such-command-here"] }];',
			'export default {',
			'	gate: { tiers: { fast: tests, default: tests } },',
			'	review: { classes: "docs/classes.md" },',
			'	probes: { faults: [{ name: "gone", patch: "probes/gone.patch", run: ["node", "x"], expect: "y" }] },',
			'};',
		].join("\n"));
		mkdirSync(join(repo.root, ".githooks"));
		writeFileSync(join(repo.root, ".githooks", "pre-push"), `#!/bin/sh\nexec node "$(git rev-parse --show-toplevel)/node_modules/@raresportan/marram/bin/marram.mjs" hook pre-push\n`);
		chmodSync(join(repo.root, ".githooks", "pre-push"), 0o644);
		repo.git("config", "core.hooksPath", ".githooks");
		const result = repo.marram(repo.root, "doctor");
		assert.equal(result.status, 1);
		const lines = result.stdout.split("\n");
		const expected = [
			"! gate.tiers.full isn't set: `marram gate full` refuses to run",
			`✗ no-such-command-here isn't on PATH, or a file from ${repo.root}, so the stages tests, more can't run`,
			"✗ .verify/ isn't ignored by Git: add it to .gitignore, or each run's logs show up as changes",
			...(process.platform === "win32" ? [] : ["✗ .githooks/pre-push isn't executable, so git skips it: `chmod +x .githooks/pre-push`"]),
			"! No commit-msg hook in .githooks runs `marram commit-lint \"$1\"`, so a review fix's classes and rungs are checked only by CI, if at all",
			"✗ review.classes is docs/classes.md, which doesn't exist",
			'✗ probe "gone": its patch, probes/gone.patch, doesn\'t exist',
		];
		for (const line of expected) assert.ok(lines.includes(line), `${line}\n---\n${result.stdout}`);
		// A hook git skips doesn't gate a push, whatever it says.
		if (process.platform !== "win32") assert.ok(!lines.some((line) => line.startsWith("✓ .githooks/pre-push")), result.stdout);

		writeFileSync(join(repo.root, "marram.config.mjs"), 'export default { gate: { tiers: { fast: [], default: [{ name: "n", run: ["node", "-v"] }], full: [] } } };');
		writeFileSync(join(repo.root, ".githooks", "commit-msg"), '#!/bin/sh\nexec npx marram commit-lint "$1"\n');
		chmodSync(join(repo.root, ".githooks", "commit-msg"), 0o755);
		assert.match(repo.marram(repo.root, "doctor").stdout, /✗ \.githooks\/commit-msg runs commit-lint, but marram\.config\.mjs has no review\.classes for it to check against/);
	} finally {
		repo.remove();
	}
});
