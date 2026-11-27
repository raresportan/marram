// The guard diff: what a branch changed in the checks that judge it. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../../bin/marram.mjs", import.meta.url));
const MAP = ["- **Counting**", '  - ✅ counts › "It starts at zero"', '  - ✅ counts › "The count survives a restart"', ""].join("\n");

/** A repository with a root project whose default gate runs the app's gate, and the app as a nested project. */
function repository() {
	const root = mkdtempSync(join(tmpdir(), "marram-guard-diff-"));
	const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	const write = (path, content) => {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), content);
	};
	const config = (gate) => `export default ${JSON.stringify({ gate: { logs: "logs", ...gate } })};`;
	const rootGate = { tiers: { fast: [], default: [{ name: "app", run: ["npm", "run", "gate", "-w", "app"] }], full: [] }, prePush: "full" };
	const appGate = {
		tiers: {
			fast: [],
			default: [{ name: "unit", run: ["npm", "test"] }, { name: "journeys", run: ["npm", "run", "verify"], env: { TOKEN: "first-secret" } }],
			full: [{ name: "unit", run: ["npm", "test"] }, { name: "journeys", run: ["npm", "run", "verify"], env: { TOKEN: "first-secret" } }],
		},
	};
	const appScripts = { gate: "marram gate", test: "node --test", verify: "node verify.mjs", lint: "eslint ." };
	write("marram.config.mjs", config(rootGate));
	write("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
	write("packages/app/marram.config.mjs", config(appGate));
	write("packages/app/package.json", JSON.stringify({ name: "app", scripts: appScripts }));
	write("packages/app/docs/feature-map.md", MAP);
	write(".githooks/pre-push", "exec marram hook pre-push\n");
	git("init", "-q", "-b", "main");
	git("config", "core.hooksPath", ".githooks");
	git("add", ".");
	git("-c", "user.name=test", "-c", "user.email=test@example.org", "commit", "-qm", "base");
	git("checkout", "-qb", "change");
	return {
		root, write, config, rootGate, appGate, appScripts,
		/** Fold the changes so far into main, so the test's own change starts from them. */
		commit: () => {
			git("add", "-A");
			git("-c", "user.name=test", "-c", "user.email=test@example.org", "commit", "-qm", "base");
			git("branch", "-f", "main", "HEAD");
		},
		diff: (...args) => spawnSync(process.execPath, [BIN, "guard-diff", "main", ...args], { cwd: root, encoding: "utf8" }),
		remove: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("guard-diff says when nothing that judges the change has changed, and what it can't see", () => {
	const repo = repository();
	try {
		const result = repo.diff();
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /^No guard changes since [0-9a-f]{7}, the merge base with main\.$/m);
		assert.match(result.stdout, /^Not compared: /m);
	} finally {
		repo.remove();
	}
});

test("guard-diff reports a stage moved out of the default gate, in a nested project, with where it still runs", () => {
	const repo = repository();
	try {
		const tiers = { ...repo.appGate.tiers, default: [repo.appGate.tiers.default[0]] };
		repo.write("packages/app/marram.config.mjs", repo.config({ tiers }));
		const result = repo.diff();
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /^packages\/app\n {2}default: removed journeys: npm run verify \(still in full\)$/m);
		assert.doesNotMatch(result.stdout, /full:/);
	} finally {
		repo.remove();
	}
});

test("guard-diff reports a changed command and names changed environment variables without their values", () => {
	const repo = repository();
	try {
		const journeys = { name: "journeys", run: ["npm", "run", "verify", "--", "--quick"], env: { TOKEN: "second-secret" } };
		const tiers = { ...repo.appGate.tiers, full: [repo.appGate.tiers.full[0], journeys] };
		repo.write("packages/app/marram.config.mjs", repo.config({ tiers }));
		const result = repo.diff();
		assert.match(result.stdout, /^ {2}full: journeys now runs npm run verify -- --quick \(was npm run verify\)$/m);
		assert.match(result.stdout, /^ {2}full: journeys env changed: TOKEN$/m);
		assert.doesNotMatch(result.stdout, /secret/);
	} finally {
		repo.remove();
	}
});

test("guard-diff reports a relaxed push requirement, a changed script a stage runs, and a removed hook", () => {
	const repo = repository();
	try {
		repo.write("marram.config.mjs", repo.config({ ...repo.rootGate, prePush: "default" }));
		repo.write("packages/app/package.json", JSON.stringify({ name: "app", scripts: { ...repo.appScripts, gate: "marram gate fast", verify: "node verify.mjs --skip-restart", lint: "true" } }));
		rmSync(join(repo.root, ".githooks/pre-push"));
		const result = repo.diff();
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /^\(root\)\n {2}prePush: full → default$/m);
		assert.match(result.stdout, /^ {2}script gate \(packages\/app\/package\.json\): marram gate fast \(was marram gate\)$/m);
		assert.match(result.stdout, /^ {2}script verify \(packages\/app\/package\.json\): node verify\.mjs --skip-restart \(was node verify\.mjs\)$/m);
		assert.doesNotMatch(result.stdout, /script lint/, "no stage runs lint");
		assert.match(result.stdout, /^Hooks \(\.githooks\)\n {2}deleted pre-push$/m);
	} finally {
		repo.remove();
	}
});

test("guard-diff lists citations removed from a feature map it's given", () => {
	const repo = repository();
	try {
		repo.write("packages/app/docs/feature-map.md", MAP.replace('  - ✅ counts › "The count survives a restart"\n', ""));
		const result = repo.diff("--map", "packages/app/docs/feature-map.md");
		assert.match(result.stdout, /^Feature map packages\/app\/docs\/feature-map\.md\n {2}removed: Counting — counts › "The count survives a restart"$/m);
	} finally {
		repo.remove();
	}
});

test("guard-diff says which configuration it couldn't load, and still compares the rest", () => {
	const repo = repository();
	try {
		repo.write("packages/app/marram.config.mjs", "export default {");
		repo.write("marram.config.mjs", repo.config({ ...repo.rootGate, prePush: "default" }));
		const result = repo.diff();
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /^packages\/app\n {2}couldn't load marram\.config\.mjs in the working tree: /m);
		assert.match(result.stdout, /prePush: full → default/);
	} finally {
		repo.remove();
	}
});

test("each side's configuration reads its own files, from its own project folder", () => {
	const repo = repository();
	try {
		const reads = 'import { readFileSync } from "node:fs";\nexport default { gate: { logs: "logs", tiers: JSON.parse(readFileSync("tiers.json", "utf8")) } };\n';
		repo.write("marram.config.mjs", reads);
		repo.write("tiers.json", JSON.stringify(repo.rootGate.tiers));
		repo.commit();
		repo.write("tiers.json", JSON.stringify({ ...repo.rootGate.tiers, default: [] }));
		const result = repo.diff();
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /^\(root\)\n {2}default: removed app: npm run gate -w app$/m);
	} finally {
		repo.remove();
	}
});

test("a deleted root configuration is reported as its gates removed, and a broken one doesn't hide the others", () => {
	const repo = repository();
	try {
		rmSync(join(repo.root, "marram.config.mjs"));
		const deleted = repo.diff();
		assert.equal(deleted.status, 0, deleted.stderr);
		assert.match(deleted.stdout, /^\(root\)\n {2}default: removed app: npm run gate -w app\n {2}prePush: full → default$/m);
		repo.write("marram.config.mjs", "export default {");
		repo.write("packages/app/marram.config.mjs", repo.config({ tiers: { ...repo.appGate.tiers, full: [] } }));
		const broken = repo.diff();
		assert.equal(broken.status, 0, broken.stderr);
		assert.match(broken.stdout, /^\(root\)\n {2}couldn't load marram\.config\.mjs in the working tree: /m);
		assert.match(broken.stdout, /^ {2}full: removed unit: npm test \(still in default\)$/m);
	} finally {
		repo.remove();
	}
});

test("a command is compared argument by argument, and shown with each argument's boundaries", () => {
	const repo = repository();
	try {
		const smoke = (...args) => ({ name: "smoke", run: ["npm", "run", ...args] });
		repo.write("marram.config.mjs", repo.config({ ...repo.rootGate, tiers: { ...repo.rootGate.tiers, full: [smoke("smoke regression")] } }));
		repo.commit();
		repo.write("marram.config.mjs", repo.config({ ...repo.rootGate, tiers: { ...repo.rootGate.tiers, full: [smoke("smoke", "regression")] } }));
		const result = repo.diff();
		assert.match(result.stdout, /^ {2}full: smoke now runs npm run smoke regression \(was npm run 'smoke regression'\)$/m);
	} finally {
		repo.remove();
	}
});

test("stages are compared in order, each occurrence of a repeated name on its own", () => {
	const repo = repository();
	try {
		const unit = repo.appGate.tiers.default[0];
		const journeys = repo.appGate.tiers.default[1];
		repo.write("packages/app/marram.config.mjs", repo.config({ tiers: { ...repo.appGate.tiers, full: [unit, unit, journeys] } }));
		repo.commit();
		repo.write("packages/app/marram.config.mjs", repo.config({ tiers: { ...repo.appGate.tiers, default: [journeys, unit], full: [unit, journeys] } }));
		const result = repo.diff();
		assert.match(result.stdout, /^ {2}default: order now journeys, unit \(was unit, journeys\)$/m);
		assert.match(result.stdout, /^ {2}full: removed unit: npm test \(still in default\)$/m);
	} finally {
		repo.remove();
	}
});

test("a project whose path git would quote is compared, and an untracked hook is reported", () => {
	const repo = repository();
	try {
		repo.write("café/marram.config.mjs", repo.config({ tiers: { fast: [], default: [{ name: "unit", run: ["npm", "test"] }], full: [] } }));
		repo.commit();
		repo.write("café/marram.config.mjs", repo.config({ tiers: { fast: [], default: [], full: [] } }));
		repo.write(".githooks/commit-msg", "exec marram commit-lint \"$1\"\n");
		const result = repo.diff();
		assert.match(result.stdout, /^café\n {2}default: removed unit: npm test$/m);
		assert.match(result.stdout, /^Hooks \(\.githooks\)\n {2}added commit-msg$/m);
	} finally {
		repo.remove();
	}
});

test("guard-diff reports the inherited variables gate.env stops or starts counting", () => {
	const repo = repository();
	try {
		repo.write("marram.config.mjs", repo.config({ ...repo.rootGate, env: ["CI", "NODE_ENV"] }));
		repo.commit();
		repo.write("marram.config.mjs", repo.config({ ...repo.rootGate, env: ["NODE_ENV", "TZ"] }));
		const result = repo.diff();
		assert.match(result.stdout, /^ {2}env: no longer counts CI for reusing a pass$/m);
		assert.match(result.stdout, /^ {2}env: now counts TZ for reusing a pass$/m);
	} finally {
		repo.remove();
	}
});

test("hooks are compared where a fresh checkout has none configured (--hooks), and where core.hooksPath is absolute", () => {
	const repo = repository();
	const git = (...args) => execFileSync("git", args, { cwd: repo.root, encoding: "utf8" }).trim();
	try {
		// As in CI: a fresh checkout, so no core.hooksPath; the branch deletes the whole folder.
		git("config", "--unset", "core.hooksPath");
		rmSync(join(repo.root, ".githooks"), { recursive: true });
		assert.doesNotMatch(repo.diff().stdout, /Hooks/, "nothing names the hooks");
		assert.match(repo.diff("--hooks", ".githooks").stdout, /^Hooks \(\.githooks\)\n {2}deleted pre-push$/m);

		repo.write(".githooks/pre-push", "exec true\n");
		git("config", "core.hooksPath", join(repo.root, ".githooks"));
		const absolute = repo.diff("--hooks", ".githooks");
		assert.match(absolute.stdout, /^Hooks \(\.githooks\)\n {2}changed pre-push$/m);
		assert.equal(absolute.stdout.match(/^Hooks/gm).length, 1, "the same folder, named twice, is compared once");

		// .git/hooks is git's own, not in the work tree, so not compared; nor read as the work tree's top.
		for (const own of [join(repo.root, ".git", "hooks"), join(repo.root, ".git", "hooks", "gone")]) {
			git("config", "core.hooksPath", own);
			const result = repo.diff();
			assert.doesNotMatch(result.stdout, /^Hooks \(\.\)|^Hooks \(gone\)/m, result.stdout);
			assert.match(result.stdout, /^Hooks \(.*\.git.*\)\n {2}outside the repository, so not compared/m);
		}

		// Another worktree of the same repository has its own files, which aren't this branch's.
		const sibling = join(mkdtempSync(join(tmpdir(), "marram-worktree-")), "other");
		try {
			git("worktree", "add", "-q", sibling, "main");
			git("config", "core.hooksPath", join(sibling, ".githooks"));
			const result = repo.diff();
			assert.doesNotMatch(result.stdout, /^Hooks \(\.githooks\)/m, result.stdout);
			assert.match(result.stdout, /^Hooks \(.*other.*\)\n {2}outside the repository, so not compared/m);
		} finally {
			git("worktree", "remove", "--force", sibling);
			rmSync(join(sibling, ".."), { recursive: true, force: true });
		}

		const elsewhere = mkdtempSync(join(tmpdir(), "marram-hooks-"));
		try {
			git("config", "core.hooksPath", elsewhere);
			assert.match(repo.diff().stdout, /^Hooks \(.*marram-hooks-.*\)\n {2}outside the repository, so not compared/m);
		} finally {
			rmSync(elsewhere, { recursive: true, force: true });
		}
	} finally {
		repo.remove();
	}
});

test("a script is compared for each stage that runs it, though tiers reuse the stage's name, and in each workspace a command names", () => {
	const repo = repository();
	try {
		// "unit" in the default tier runs app's check, and "unit" in the full tier other's; "lint" runs in both. The app
		// project's own config runs neither script, so only the root project's stages report them.
		const tiers = {
			fast: [],
			default: [{ name: "unit", run: ["npm", "run", "check", "-w", "app"] }, { name: "lint", run: ["npm", "run", "lint", "-w", "app", "-w", "other"] }],
			full: [{ name: "unit", run: ["npm", "run", "check", "-w", "other"] }],
		};
		repo.write("marram.config.mjs", repo.config({ ...repo.rootGate, tiers }));
		repo.write("packages/app/package.json", JSON.stringify({ name: "app", scripts: { ...repo.appScripts, check: "node check.mjs" } }));
		repo.write("packages/other/package.json", JSON.stringify({ name: "other", scripts: { check: "node check.mjs", lint: "eslint ." } }));
		repo.commit();
		repo.write("packages/app/package.json", JSON.stringify({ name: "app", scripts: { ...repo.appScripts, check: "true" } }));
		repo.write("packages/other/package.json", JSON.stringify({ name: "other", scripts: { check: "node check.mjs", lint: "true" } }));
		const result = repo.diff();
		assert.match(result.stdout, /^ {2}script check \(packages\/app\/package\.json\): true \(was node check\.mjs\)$/m, result.stdout);
		assert.match(result.stdout, /^ {2}script lint \(packages\/other\/package\.json\): true \(was eslint \.\)$/m, result.stdout);
	} finally {
		repo.remove();
	}
});

test("a stage's workspace is found in each revision, so swapped package names show the script that now runs", () => {
	const repo = repository();
	try {
		const integration = { name: "integration", run: ["npm", "test", "-w", "app"] };
		repo.write("marram.config.mjs", repo.config({ ...repo.rootGate, tiers: { ...repo.rootGate.tiers, full: [integration] } }));
		repo.write("packages/other/package.json", JSON.stringify({ name: "other", scripts: { test: "node smoke.mjs" } }));
		repo.commit();
		repo.write("packages/app/package.json", JSON.stringify({ name: "other", scripts: repo.appScripts }));
		repo.write("packages/other/package.json", JSON.stringify({ name: "app", scripts: { test: "node smoke.mjs" } }));
		const result = repo.diff();
		assert.match(result.stdout, /^ {2}script test \(packages\/other\/package\.json, was packages\/app\/package\.json\): node smoke\.mjs \(was node --test\)$/m);
	} finally {
		repo.remove();
	}
});

test("a command run in every workspace (--workspaces, -ws) has its script compared in each, and in the root when it's included", () => {
	const repo = repository();
	try {
		const tiers = {
			fast: [],
			default: [{ name: "lint", run: ["npm", "run", "lint", "--workspaces", "--if-present"] }],
			full: [{ name: "check", run: ["npm", "run", "check", "-ws", "--include-workspace-root"] }],
		};
		repo.write("marram.config.mjs", repo.config({ ...repo.rootGate, tiers }));
		repo.write("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"], scripts: { check: "node root-check.mjs" } }));
		repo.write("packages/other/package.json", JSON.stringify({ name: "other", scripts: { check: "node check.mjs", lint: "eslint ." } }));
		repo.commit();
		repo.write("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"], scripts: { check: "true" } }));
		repo.write("packages/other/package.json", JSON.stringify({ name: "other", scripts: { check: "true", lint: "true" } }));
		// A workspace added under the same command: its script now runs too.
		repo.write("packages/third/package.json", JSON.stringify({ name: "third", scripts: { lint: "true" } }));
		const result = repo.diff();
		assert.match(result.stdout, /^ {2}script lint \(packages\/other\/package\.json\): true \(was eslint \.\)$/m, result.stdout);
		assert.match(result.stdout, /^ {2}script check \(packages\/other\/package\.json\): true \(was node check\.mjs\)$/m, result.stdout);
		assert.match(result.stdout, /^ {2}script check \(package\.json\): true \(was node root-check\.mjs\)$/m, result.stdout);
		assert.match(result.stdout, /^ {2}script lint \(packages\/third\/package\.json\): added: true$/m, result.stdout);
	} finally {
		repo.remove();
	}
});

test("a workspace taken out of (or put into) package.json's workspaces, under the same --workspaces command, is reported", () => {
	const repo = repository();
	try {
		const tiers = { fast: [], default: [{ name: "lint", run: ["npm", "run", "lint", "--workspaces"] }], full: [] };
		repo.write("marram.config.mjs", repo.config({ ...repo.rootGate, tiers }));
		repo.write("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*", "!packages/third"] }));
		repo.write("packages/other/package.json", JSON.stringify({ name: "other", scripts: { lint: "eslint ." } }));
		repo.write("packages/third/package.json", JSON.stringify({ name: "third", scripts: { lint: "eslint src" } }));
		repo.commit();
		repo.write("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*", "!packages/other"] }));
		const result = repo.diff();
		assert.match(result.stdout, /^ {2}script lint \(packages\/other\/package\.json\): no longer run \(eslint \.\)$/m, result.stdout);
		assert.match(result.stdout, /^ {2}script lint \(packages\/third\/package\.json\): now run: eslint src$/m, result.stdout);
	} finally {
		repo.remove();
	}
});

test("with --json, guard-diff's sections are JSON", () => {
	const repo = repository();
	try {
		repo.write("marram.config.mjs", repo.config({ ...repo.rootGate, prePush: "default" }));
		const result = repo.diff("--json");
		assert.equal(result.status, 0, result.stderr);
		const report = JSON.parse(result.stdout);
		assert.equal(report.base, "main");
		assert.match(report.mergeBase, /^[0-9a-f]{40}$/);
		assert.deepEqual(report.sections, [{ title: "(root)", lines: ["prePush: full → default"] }]);
		assert.match(report.notCompared, /^Not compared: /);
	} finally {
		repo.remove();
	}
});

test("a configuration that prints while it loads is still read", () => {
	const repo = repository();
	try {
		repo.write("marram.config.mjs", `console.log("loading config");\nconsole.error("loading config");\n${repo.config({ ...repo.rootGate, prePush: "default" })}`);
		const result = repo.diff();
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /^\(root\)\n {2}prePush: full → default$/m);
	} finally {
		repo.remove();
	}
});

test("a removed stage is said to still run elsewhere only where the same command runs with the same environment", () => {
	const elsewhere = {
		"another command": { name: "journeys", run: ["npm", "run", "lint"], env: { TOKEN: "first-secret" } },
		"another environment": { name: "journeys", run: ["npm", "run", "verify"], env: { TOKEN: "second-secret" } },
	};
	for (const [difference, journeys] of Object.entries(elsewhere)) {
		const repo = repository();
		try {
			const unit = repo.appGate.tiers.default[0];
			repo.write("packages/app/marram.config.mjs", repo.config({ tiers: { fast: [], default: [unit], full: [unit, journeys] } }));
			const result = repo.diff();
			assert.match(result.stdout, /^ {2}default: removed journeys: npm run verify$/m, difference);
		} finally {
			repo.remove();
		}
	}
});

test("a script is compared by the stage that runs it, even when that stage's arguments change too", () => {
	const repo = repository();
	try {
		const quiet = { ...repo.appGate.tiers.default[1], run: ["npm", "run", "verify", "--silent"] };
		const unit = repo.appGate.tiers.default[0];
		repo.write("packages/app/marram.config.mjs", repo.config({ tiers: { fast: [], default: [unit, quiet], full: [unit, quiet] } }));
		repo.write("packages/app/package.json", JSON.stringify({ name: "app", scripts: { ...repo.appScripts, verify: "node smoke.mjs" } }));
		const result = repo.diff();
		assert.match(result.stdout, /^ {2}default: journeys now runs npm run verify --silent \(was npm run verify\)$/m);
		assert.match(result.stdout, /^ {2}script verify \(packages\/app\/package\.json\): node smoke\.mjs \(was node verify\.mjs\)$/m);
	} finally {
		repo.remove();
	}
});

test("the pre and post scripts npm runs around a stage's script are compared too", () => {
	const repo = repository();
	try {
		repo.write("packages/app/package.json", JSON.stringify({ name: "app", scripts: { ...repo.appScripts, pretest: "node integration.mjs", posttest: "node report.mjs" } }));
		repo.commit();
		repo.write("packages/app/package.json", JSON.stringify({ name: "app", scripts: { ...repo.appScripts, posttest: "true" } }));
		const result = repo.diff();
		assert.match(result.stdout, /^ {2}script pretest \(packages\/app\/package\.json\): removed \(was node integration\.mjs\)$/m);
		assert.match(result.stdout, /^ {2}script posttest \(packages\/app\/package\.json\): true \(was node report\.mjs\)$/m);
	} finally {
		repo.remove();
	}
});

test("guard-diff reports probes removed, added or loosened, and a patch whose contents changed", () => {
	const repo = repository();
	try {
		const probes = (faults) => `export default { gate: ${JSON.stringify({ logs: "logs", ...repo.rootGate })}, probes: { faults: [${faults}] } };\n`;
		const zero = (expect) => `{ name: "a stored zero", patch: "probes/zero.patch", run: ["node", "check.cjs"], expect: ${expect} }`;
		const rollback = '{ name: "a rollback", patch: "probes/rollback.patch", run: ["node", "check.cjs"], expect: "rolled back" }';
		repo.write("marram.config.mjs", probes(`${zero("/stored value/")}, ${rollback}`));
		repo.write("probes/zero.patch", "first\n");
		repo.write("probes/rollback.patch", "first\n");
		repo.commit();
		repo.write("marram.config.mjs", probes(`${zero("/./")}, { name: "a smoke test", patch: "probes/zero.patch", run: ["true"], expect: "x" }`));
		repo.write("probes/zero.patch", "second\n");
		const result = repo.diff();
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /^ {2}probe a stored zero: expect now \/\.\/ \(was \/stored value\/\)$/m);
		assert.match(result.stdout, /^ {2}probe a stored zero: patch probes\/zero\.patch changed$/m);
		assert.match(result.stdout, /^ {2}probe removed: a rollback$/m);
		assert.match(result.stdout, /^ {2}probe added: a smoke test$/m);
	} finally {
		repo.remove();
	}
});

test("guard-diff reports how the probes' copy is prepared, and not a fault's test keys in another order", () => {
	const repo = repository();
	try {
		const probes = (settings, test) => `export default { gate: ${JSON.stringify({ logs: "logs", ...repo.rootGate })}, probes: { ${settings} faults: [{ name: "a stored zero", patch: "probes/zero.patch", test: ${test} }] } };\n`;
		repo.write("probes/zero.patch", "patch\n");
		repo.write("marram.config.mjs", probes('setup: ["npm", "ci"], link: ["node_modules"], timeoutMs: 300000,', '{ file: "a.test.mjs", name: "reads one", assertion: "stored value" }'));
		repo.commit();
		repo.write("marram.config.mjs", probes('setup: ["true"], link: [], timeoutMs: 1000,', '{ assertion: "stored value", name: "reads one", file: "a.test.mjs" }'));
		const result = repo.diff();
		assert.match(result.stdout, /^ {2}probes setup now true \(was npm ci\)$/m);
		assert.match(result.stdout, /^ {2}probes link now \[\] \(was \["node_modules"\]\)$/m);
		assert.match(result.stdout, /^ {2}probes timeoutMs now 1000 \(was 300000\)$/m);
		assert.doesNotMatch(result.stdout, /test now/);
	} finally {
		repo.remove();
	}
});

test("guard-diff reports tests removed, newly skipped or with fewer assertions, and test files removed or renamed away", () => {
	const repo = repository();
	try {
		const js = (...tests) => tests.join("\n") + "\n";
		repo.write("packages/app/test/value.test.mjs", js(
			'test("reads one", () => { assert.equal(read(), 1); assert.ok(read()); });',
			'test("reads two", () => assert.equal(read(), 2));',
			'test("reads three", () => assert.equal(read(), 3));',
		));
		repo.write("packages/app/tests/test_store.py", "def test_saves():\n    assert save()\n\ndef test_loads():\n    assert load()\n");
		repo.write("packages/app/test/moved.test.mjs", js('test("moves", () => assert.ok(1));'));
		repo.write("packages/app/test/hidden.test.mjs", js('test("hides", () => assert.ok(1));'));
		repo.commit();
		repo.write("packages/app/test/value.test.mjs", js(
			'test("reads one", () => { assert.ok(read()); });',
			'test.skip("reads two", () => assert.equal(read(), 2));',
			'test("reads four", () => assert.equal(read(), 4));',
		));
		rmSync(join(repo.root, "packages/app/tests/test_store.py"));
		repo.write("packages/app/test/renamed.test.mjs", js('test("moves", () => assert.ok(1));'));
		rmSync(join(repo.root, "packages/app/test/moved.test.mjs"));
		repo.write("packages/app/hidden.mjs", js('test("hides", () => assert.ok(1));'));
		rmSync(join(repo.root, "packages/app/test/hidden.test.mjs"));
		const result = repo.diff();
		assert.equal(result.status, 0, result.stderr);
		const tests = result.stdout.split("\nTests\n")[1]?.split("\n\n")[0];
		// In the order git lists the files: by path.
		assert.equal(tests, [
			"  no longer named as a test file: packages/app/test/hidden.test.mjs → packages/app/hidden.mjs (1 test)",
			"  fewer assertions: packages/app/test/value.test.mjs › reads one (2 → 1)",
			"  now skipped: packages/app/test/value.test.mjs › reads two",
			"  removed: packages/app/test/value.test.mjs › reads three",
			"  removed file packages/app/tests/test_store.py: 2 tests",
		].join("\n"), result.stdout);
		assert.doesNotMatch(result.stdout, /moved\.test|renamed\.test/, "a test file renamed with its tests is no change");
		assert.doesNotMatch(result.stdout, /Not compared: test files/);
	} finally {
		repo.remove();
	}
});

test("guard-diff reports a test now run alone, and not a test helper moved or removed", () => {
	const repo = repository();
	try {
		repo.write("packages/app/test/value.test.mjs", 'test("reads one", () => assert.ok(1));\ntest("reads two", () => assert.ok(2));\n');
		repo.write("packages/app/test/helpers.mjs", "export const read = () => 1;\n");
		repo.write("packages/app/tests/conftest.py", "import pytest\n");
		repo.commit();
		repo.write("packages/app/test/value.test.mjs", 'test.only("reads one", () => assert.ok(1));\ntest("reads two", () => assert.ok(2));\ntest.only("reads three", () => assert.ok(3));\n');
		repo.write("packages/app/support/helpers.mjs", "export const read = () => 1;\n");
		rmSync(join(repo.root, "packages/app/test/helpers.mjs"));
		rmSync(join(repo.root, "packages/app/tests/conftest.py"));
		const result = repo.diff();
		assert.equal(result.stdout.split("\nTests\n")[1]?.split("\n\n")[0], [
			"  now only: packages/app/test/value.test.mjs › reads one",
			"  now only: packages/app/test/value.test.mjs › reads three",
		].join("\n"), result.stdout);
	} finally {
		repo.remove();
	}
});
