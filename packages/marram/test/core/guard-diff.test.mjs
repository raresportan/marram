// The guard diff: what a branch changed in the checks that judge it. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const BIN = new URL("../../bin/marram.mjs", import.meta.url).pathname;
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
