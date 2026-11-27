// The pre-push hook against the gate a project asks of a push (`gate.prePush`), reusing what a gate already passed.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../../bin/marram.mjs", import.meta.url));

/** A stage that notes its run in an ignored file, then exits with `code`. */
const stage = (name, { code = 0, env } = {}) => ({ name, run: ["node", "-e", `require("fs").appendFileSync("runs", ${JSON.stringify(name)}); process.exit(${code})`], ...(env ? { env } : {}) });

/** A repository whose default gate runs stage "d" and full gate "d" then "f", unless `tiers` says otherwise. */
function project({ prePush, tiers = { fast: [], default: [stage("d")], full: [stage("d"), stage("f")] } } = {}) {
	const root = mkdtempSync(join(tmpdir(), "marram-hook-"));
	const configure = (tiers) => writeFileSync(join(root, "marram.config.mjs"), `export default ${JSON.stringify({ gate: { logs: "logs", tiers, ...(prePush === undefined ? {} : { prePush }) } })};`);
	configure(tiers);
	writeFileSync(join(root, ".gitignore"), "logs/\nruns\n");
	const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	git("init", "-q");
	const commit = (content) => {
		writeFileSync(join(root, "code.txt"), content);
		git("add", "-A");
		git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", content);
		return git("rev-parse", "HEAD");
	};
	const marram = (args, input = "") => spawnSync("node", [BIN, ...args], { cwd: root, input, encoding: "utf8" });
	return {
		root,
		configure,
		commit,
		runs: () => (existsSync(join(root, "runs")) ? readFileSync(join(root, "runs"), "utf8") : ""),
		push: (sha) => marram(["hook", "pre-push"], `refs/heads/main ${sha} refs/heads/main ${"0".repeat(40)}\n`),
		gate: (...tier) => marram(["gate", ...tier]),
		finish: () => marram(["hook", "finish"]),
		remove: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("a push the project asks the full gate of runs it, once", () => {
	const repo = project({ prePush: "full" });
	try {
		const sha = repo.commit("one");
		const first = repo.push(sha);
		assert.equal(first.status, 0, first.stderr);
		assert.equal(repo.runs(), "df");
		assert.equal(repo.push(sha).status, 0);
		assert.equal(repo.runs(), "df", "the full pass is reused");
	} finally {
		repo.remove();
	}
});

test("a default pass doesn't do for a push that needs the full gate", () => {
	const repo = project({ prePush: "full" });
	try {
		const sha = repo.commit("one");
		assert.equal(repo.gate().status, 0);
		assert.equal(repo.runs(), "d");
		assert.equal(repo.push(sha).status, 0);
		assert.equal(repo.runs(), "ddf");
	} finally {
		repo.remove();
	}
});

test("a full pass counts for the default gate, and a default run after it doesn't replace it", () => {
	const repo = project({ prePush: "full" });
	try {
		const sha = repo.commit("one");
		assert.equal(repo.gate("full").status, 0);
		assert.equal(repo.finish().status, 0);
		assert.equal(repo.runs(), "df", "finish reuses the full pass");
		assert.equal(repo.gate().status, 0);
		assert.equal(repo.push(sha).status, 0);
		assert.equal(repo.runs(), "dfd", "the push still finds the full pass");
	} finally {
		repo.remove();
	}
});

test("without gate.prePush, a push needs the default gate", () => {
	const repo = project();
	try {
		const sha = repo.commit("one");
		assert.equal(repo.push(sha).status, 0);
		assert.equal(repo.runs(), "d");
	} finally {
		repo.remove();
	}
});

test("gate.prePush names a gate a push can require", () => {
	const repo = project({ prePush: "fast" });
	try {
		const refused = repo.push(repo.commit("one"));
		assert.equal(refused.status, 1);
		assert.match(refused.stderr, /a push can require the default gate or the full one/);
	} finally {
		repo.remove();
	}
});

test("a nested project's full pass cannot satisfy the root project's finish hook", () => {
	const repo = project();
	try {
		const nested = join(repo.root, "example");
		mkdirSync(nested);
		copyFileSync(join(repo.root, "marram.config.mjs"), join(nested, "marram.config.mjs"));
		repo.commit("one");
		const full = spawnSync("node", [BIN, "gate", "full"], { cwd: nested, encoding: "utf8" });
		assert.equal(full.status, 0, full.stderr);
		assert.equal(repo.finish().status, 0);
		assert.equal(repo.runs(), "d", "finish must run the root project's stage");
		assert.equal(repo.finish().status, 0);
		assert.equal(repo.runs(), "d", "finish reuses the root project's own pass");
	} finally {
		repo.remove();
	}
});

test("a full pass counts for the default gate only when it ran the default stages, in order, as configured", () => {
	const unlike = {
		"a different stage": { default: [stage("t", { code: 1 })], full: [stage("b")] },
		"the same stage with another environment": { default: [stage("d", { env: { MODE: "strict" } })], full: [stage("d"), stage("f")] },
		"the default stages in another order": { default: [stage("d"), stage("f")], full: [stage("f"), stage("d")] },
	};
	for (const [difference, tiers] of Object.entries(unlike)) {
		const repo = project({ tiers: { fast: [], ...tiers } });
		try {
			repo.commit("one");
			const full = repo.gate("full");
			assert.equal(full.status, 0, full.stdout + full.stderr);
			const runs = repo.runs();
			const finish = repo.finish();
			assert.notEqual(repo.runs(), runs, `${difference}: finish must run the default gate`);
			assert.equal(finish.status, tiers.default.some(({ run }) => run[2].includes("exit(1)")) ? 1 : 0, `${difference}: finish reports the default gate's result\n${finish.stdout}`);
		} finally {
			repo.remove();
		}
	}
	const repo = project({ tiers: { fast: [], default: [stage("d"), stage("e")], full: [stage("d"), stage("x"), stage("e")] } });
	try {
		repo.commit("one");
		assert.equal(repo.gate("full").status, 0);
		assert.equal(repo.finish().status, 0);
		assert.equal(repo.runs(), "dxe", "a full gate with extra stages between the default ones still answers for it");
	} finally {
		repo.remove();
	}
});

test("a push is judged by the configuration of the tree the full gate ran on, not the one checked out now", () => {
	const build = stage("b");
	const repo = project({ tiers: { fast: [], default: [stage("t", { code: 1 })], full: [build] } });
	try {
		const sha = repo.commit("one");
		assert.equal(repo.gate("full").status, 0);
		repo.configure({ fast: [], default: [build], full: [build] });
		const push = repo.push(sha);
		assert.equal(push.status, 1, "the pushed commit's own default gate fails");
	} finally {
		repo.remove();
	}
});

test("a verdict counts only while the configuration gives the stages it ran, which the environment can change", () => {
	const repo = project();
	try {
		// Stages built from the environment: with EXTRA set, the default gate also runs a stage that fails.
		const [d, f, x] = [stage("d"), stage("f"), stage("x", { code: 1 })];
		writeFileSync(join(repo.root, "marram.config.mjs"), `const extra = process.env.EXTRA ? [${JSON.stringify(x)}] : [];\nexport default { gate: { logs: "logs", tiers: { fast: [], default: [${JSON.stringify(d)}, ...extra], full: [${JSON.stringify(d)}, ${JSON.stringify(f)}] } } };\n`);
		repo.commit("one");
		const finish = (env = {}) => spawnSync("node", [BIN, "hook", "finish"], { cwd: repo.root, encoding: "utf8", env: { ...process.env, ...env } });

		assert.equal(repo.gate("full").status, 0);
		assert.equal(finish().status, 0, "the full pass covers the default stages as configured");
		assert.equal(repo.runs(), "df");
		const extra = finish({ EXTRA: "1" });
		assert.equal(extra.status, 1, "with EXTRA the default gate has a stage the full pass didn't run");
		assert.equal(repo.runs(), "dfdx");

		assert.equal(repo.gate().status, 0);
		assert.equal(repo.runs(), "dfdxd");
		assert.equal(finish().status, 0, "the default pass is reused for the same stages");
		assert.equal(finish({ EXTRA: "1" }).status, 1, "but not for others");
		assert.equal(repo.runs(), "dfdxd", "whose own failure, under 15 minutes old, is reused");
	} finally {
		repo.remove();
	}
});

test("an inherited variable gate.env names decides whether a verdict counts, and one it doesn't name doesn't", () => {
	const repo = project();
	try {
		// The stage fails when FAIL is set, which it inherits rather than being given.
		const d = { name: "d", run: ["node", "-e", 'require("fs").appendFileSync("runs", "d"); process.exit(process.env.FAIL ? 1 : 0)'] };
		const configure = (env) => writeFileSync(join(repo.root, "marram.config.mjs"), `export default ${JSON.stringify({ gate: { logs: "logs", ...env, tiers: { fast: [], default: [d], full: [d] } } })};\n`);
		const finish = (env = {}) => spawnSync("node", [BIN, "hook", "finish"], { cwd: repo.root, encoding: "utf8", env: { ...process.env, ...env } });
		configure({ env: ["FAIL"] });
		repo.commit("one");
		assert.equal(repo.gate().status, 0);
		assert.equal(finish({ FAIL: "1" }).status, 1, "FAIL is named, so the pass made without it doesn't count");
		assert.equal(repo.runs(), "dd");

		configure({});
		repo.commit("two");
		assert.equal(repo.gate().status, 0);
		assert.equal(finish({ FAIL: "1" }).status, 0, "unnamed, an inherited variable doesn't count: the pass is reused");
		assert.equal(repo.runs(), "ddd");
	} finally {
		repo.remove();
	}
});

test("finish in a folder of the project judges the config as the gate does, from the project's root", () => {
	const repo = project();
	try {
		// A stage built from the folder the config is evaluated in.
		writeFileSync(join(repo.root, "marram.config.mjs"), 'const d = { name: "d", run: ["node", "-e", `require("fs").appendFileSync("runs", "d")`, process.cwd()] };\nexport default { gate: { logs: "logs", tiers: { fast: [], default: [d], full: [d] } } };\n');
		mkdirSync(join(repo.root, "sub"));
		writeFileSync(join(repo.root, "sub", "file.txt"), "x");
		repo.commit("one");
		assert.equal(repo.gate().status, 0);
		const finish = spawnSync("node", [BIN, "hook", "finish"], { cwd: join(repo.root, "sub"), encoding: "utf8" });
		assert.equal(finish.status, 0, finish.stdout + finish.stderr);
		assert.equal(repo.runs(), "d", "the pass is reused");
	} finally {
		repo.remove();
	}
});

test("gates run with different stages on the same tree keep a verdict each, and the secret isn't kept with them", () => {
	const repo = project();
	try {
		const d = { name: "d", run: ["node", "-e", 'require("fs").appendFileSync("runs", process.env.MODE)'] };
		writeFileSync(join(repo.root, "marram.config.mjs"), `export default ${JSON.stringify({ gate: { logs: "logs", env: ["MODE"], tiers: { fast: [], default: [d], full: [d] } } })};\n`);
		repo.commit("one");
		const run = (args, MODE) => spawnSync("node", [BIN, ...args], { cwd: repo.root, encoding: "utf8", env: { ...process.env, MODE } });
		assert.equal(run(["gate"], "a").status, 0);
		assert.equal(run(["gate"], "b").status, 0);
		assert.equal(run(["hook", "finish"], "a").status, 0);
		assert.equal(run(["hook", "finish"], "b").status, 0);
		assert.equal(repo.runs(), "ab", "each environment's pass is still there");

		const key = join(repo.root, ".git", "marram-gate.key");
		const secret = readFileSync(key, "utf8");
		assert.doesNotMatch(readFileSync(join(repo.root, ".git", "marram-gate.json"), "utf8"), new RegExp(secret));
		if (process.platform !== "win32") assert.equal(statSync(key).mode & 0o777, 0o600);
	} finally {
		repo.remove();
	}
});

test("a verdict doesn't keep the commands or environment of the stages it ran", () => {
	const repo = project({ tiers: { fast: [], default: [stage("d", { env: { TOKEN: "synthetic-secret-value" } })], full: [stage("d", { env: { TOKEN: "synthetic-secret-value" } })] } });
	try {
		repo.commit("one");
		assert.equal(repo.gate("full").status, 0);
		const state = readFileSync(join(repo.root, ".git", "marram-gate.json"), "utf8");
		assert.doesNotMatch(state, /synthetic-secret-value|appendFileSync/);
	} finally {
		repo.remove();
	}
});

test("without a default tier, a full pass doesn't answer for the default gate", () => {
	const repo = project({ tiers: { fast: [], full: [stage("f")] } });
	try {
		repo.commit("one");
		assert.equal(repo.gate("full").status, 0);
		const finish = repo.finish();
		assert.equal(finish.status, 1);
		assert.match(finish.stderr, /has no gate\.tiers\.default/);
	} finally {
		repo.remove();
	}
});
