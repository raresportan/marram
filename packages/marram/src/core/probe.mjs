// Does the gate still catch the defects it was built to catch? Usage: marram probe [fault name]…
// Each fault in `probes.faults` is a patch that puts a known defect back, and the check that must catch it. In a
// disposable copy of the working tree (uncommitted changes included, as the gate sees it), the check runs clean and must
// pass, then runs with the patch applied and must fail for the reason given. A fault the check passes with is missed:
// that defect can pass the gate again. One that can't be judged (the clean run fails, the patch no longer applies, the
// check fails some other way) is inconclusive. Exits 1 unless every fault is caught.
//
//   probes: {
//     setup: ["npm", "ci"],          // optional: run once in the copy, before the faults
//     link: ["node_modules"],        // optional: ignored paths shared from the working tree rather than rebuilt; links
//                                    //   in them that lead into the repository lead into the copy instead
//     timeoutMs: 300000,             // optional: for each command
//     faults: [
//       { name, patch: "probes/no-rollback.patch", run: ["pytest", "tests/test_tx.py"], expect: /balance unchanged/ },
//       { name, patch, test: { file: "test/tx.test.mjs", name: "rolls back", assertion: "balance unchanged" } },
//     ],
//   }
//
// Paths are the project's, and so is where commands run unless a fault gives `cwd`. A patch is `git diff` output, applied
// at the repository root. `expect` is a RegExp, or a string the output must contain. A `test` fault is node:test's, judged
// as replay judges it: the named test passes clean, and fails with the patch at the assertion with that message.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { checkoutTree, repoPath, scratchFolder } from "./checkout.mjs";
import { probesProblems } from "./config.mjs";
import { runBounded } from "./bounded.mjs";
import { spawnable } from "./command.mjs";
import { outputExcerpt as excerpt } from "./failure-excerpt.mjs";
import { jsonOption, printJson } from "./json-output.mjs";
import { treeOf } from "./gate-state.mjs";
import { runNamedTest } from "./node-test.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();

export function probe(root, config, given) {
	const { json, args: names, say } = jsonOption(given);
	// Checked as loading the config checks it, for a caller that hands one over directly.
	const [problem] = probesProblems(config.probes ?? {});
	if (problem !== undefined) throw new Error(problem);
	const { setup, link = [], timeoutMs = 300_000, faults } = config.probes;
	const chosen = choose(faults, names);
	for (const path of link) {
		// A link to nothing would let what runs in the copy create that path in the working tree, through the link.
		if (!lstatSync(resolve(root, path), { throwIfNoEntry: false })) throw new Error(`probes.link: ${path} isn't in the working tree`);
	}
	const repo = git(root, "rev-parse", "--show-toplevel");
	const scratch = scratchFolder("marram-probe-copy-");
	const forget = () => rmSync(scratch, { recursive: true, force: true });
	const signals = ["SIGINT", "SIGTERM"].map((signal) => {
		const stop = () => {
			forget();
			process.exit(128 + (signal === "SIGINT" ? 2 : 15));
		};
		process.once(signal, stop);
		return [signal, stop];
	});
	try {
		const copy = join(scratch, "copy");
		checkoutTree(repo, treeOf(root), copy);
		const project = join(copy, repoPath(root));
		for (const path of link) {
			const target = join(project, path);
			// lstat, so a tracked link to nothing counts as there.
			if (lstatSync(target, { throwIfNoEntry: false })) throw new Error(`probes.link: ${path} is in the working tree, and only an ignored path can be linked`);
			mkdirSync(dirname(target), { recursive: true });
			share(resolve(root, path), target, repo, copy);
		}
		if (setup !== undefined) {
			const result = command(project, setup, timeoutMs);
			if (result.error?.code === "ETIMEDOUT") throw new Error(`probes.setup didn't finish within ${timeoutMs} ms`);
			if (result.status !== 0) throw new Error(`probes.setup failed: ${result.error?.message ?? excerpt(result.output)}`);
		}
		const snapshot = snapshotOf(copy, scratch, link.map((path) => repoPath(root, path)));
		const verdicts = chosen.map((fault) => {
			const started = Date.now();
			let verdict;
			try {
				verdict = judge(root, copy, project, fault, timeoutMs, join(scratch, "observations.jsonl"), () => snapshot.restore());
			} finally {
				// The next fault runs in the copy as setup left it, whatever this one's checks wrote or rewrote.
				snapshot.restore();
			}
			const line = { caught: `✓ ${fault.name}: caught (${Date.now() - started} ms)`, missed: `✗ ${fault.name}: missed: the check passed with the fault in place`, inconclusive: `? ${fault.name}: inconclusive: ${verdict.detail}` }[verdict.state];
			say(line);
			return { name: fault.name, ...verdict, ms: Date.now() - started };
		});
		const caught = verdicts.filter((verdict) => verdict.state === "caught").length;
		const missed = verdicts.filter((verdict) => verdict.state === "missed").map((verdict) => verdict.name);
		say(`${caught}/${verdicts.length} faults caught${missed.length > 0 ? `. Missed: ${missed.join(", ")}` : ""}`);
		if (json) printJson({ caught, total: verdicts.length, faults: verdicts });
		if (caught !== verdicts.length) process.exitCode = 1;
	} finally {
		for (const [signal, stop] of signals) process.off(signal, stop);
		forget();
	}
}

/**
 * `source` from the working tree at `target` in the copy, shared rather than copied. A file, or a folder with no links
 * within two levels of it, is one link to the original. A folder with links that near (a node_modules folder whose
 * workspace packages are all scoped has them only in its scopes and .bin) is made again in the copy, each entry shared the same way, and each link that leads into the repository is pointed at
 * the same place in the copy: otherwise a workspace package linked from node_modules would be the working tree's, and a
 * fault patched into the copy's would go unchecked. Its plain files are copied, since a wrapper script in .bin finds its
 * package relative to itself.
 */
function share(source, target, repo, copy) {
	const entry = lstatSync(source);
	if (entry.isSymbolicLink()) {
		const named = resolve(dirname(source), readlinkSync(source));
		// Real paths on both sides: the repository's comes from git, already real, and a link may name it another way.
		// The operating system's real paths (on Windows, long names, not short ones like RUNNER~1), on both sides.
		const leadsTo = existsSync(named) ? realpathSync.native(named) : named;
		const inside = relative(realpathSync.native(repo), leadsTo);
		const intoRepo = inside !== ".." && !inside.startsWith(".." + sep) && !isAbsolute(inside);
		symlinkSync(intoRepo ? relative(dirname(target), join(copy, inside)) : leadsTo, target);
	} else if (entry.isDirectory() && hasLink(source, 2)) {
		mkdirSync(target);
		for (const child of readdirSync(source, { withFileTypes: true })) {
			if (child.isFile()) cpSync(join(source, child.name), join(target, child.name), { preserveTimestamps: true });
			else share(join(source, child.name), join(target, child.name), repo, copy);
		}
	} else {
		symlinkSync(source, target);
	}
}

/** Whether `folder` has a link in it, or within `levels` levels of folders below it. */
function hasLink(folder, levels) {
	const children = readdirSync(folder, { withFileTypes: true });
	return children.some((child) => child.isSymbolicLink()) || (levels > 1 && children.some((child) => child.isDirectory() && hasLink(join(folder, child.name), levels - 1)));
}

/** The faults `names` picks: all of them when it's empty. */
function choose(faults, names) {
	for (const name of names) if (!faults.some((fault) => fault.name === name)) throw new Error(`No fault named "${name}" in probes.faults`);
	return names.length === 0 ? faults : faults.filter((fault) => names.includes(fault.name));
}

/**
 * `{ state, detail }`: caught, missed or inconclusive. The files the patch touched are put back, times included, before
 * this returns; the caller restores the rest of the copy.
 */
function judge(root, copy, project, fault, timeoutMs, observations, reset) {
	const cwd = join(project, fault.cwd ?? ".");
	const check = () => {
		if (fault.test) {
			rmSync(observations, { force: true });
			const result = runNamedTest({ cwd, file: fault.test.file, name: fault.test.name, assertion: fault.test.assertion, output: observations, timeout: timeoutMs });
			return { ...result, state: { passed: "passed", "failed assertion": "expected" }[result.state] ?? "other" };
		}
		const result = command(cwd, fault.run, timeoutMs);
		if (result.error?.code === "ETIMEDOUT") return { state: "other", detail: `the check didn't finish within ${timeoutMs} ms` };
		if (result.error || result.status === null) return { state: "other", detail: result.error?.message ?? "the check didn't finish" };
		if (result.status === 0) return { state: "passed" };
		const expected = fault.expect instanceof RegExp ? fault.expect.test(result.output) : result.output.includes(fault.expect);
		return { state: expected ? "expected" : "other", detail: excerpt(result.output) };
	};
	const clean = check();
	if (clean.state !== "passed") return { state: "inconclusive", detail: `the check fails without the fault: ${clean.detail}` };
	// The patched run starts where the clean one did: what the clean run wrote (an output file, a cache) would otherwise
	// be there, and a check that fails on it would have its failure put down to the patch.
	reset();
	const patch = resolve(root, fault.patch);
	// Each file's times too, put back with the file: a build tool that compares them would otherwise take the next
	// fault's copy for one whose sources changed since it was built.
	const touched = touchedBy(copy, patch);
	const times = touched.filter((file) => existsSync(join(copy, file))).map((file) => [join(copy, file), statSync(join(copy, file))]);
	const applied = spawnSync("git", ["apply", "--whitespace=nowarn", patch], { cwd: copy, encoding: "utf8" });
	if (applied.status !== 0) return { state: "inconclusive", detail: `the patch no longer applies: ${(applied.stderr || applied.error?.message || "").trim().split("\n")[0]}` };
	let faulty;
	try {
		faulty = check();
	} finally {
		// The patch comes out with the rest of what the fault changed (snapshot.restore), and the files it touched get
		// their times back once they're restored: done here, after a restore of its own.
		restoreTouched(copy, touched);
		for (const [file, { atimeMs, mtimeMs }] of times) if (existsSync(file)) utimesSync(file, atimeMs / 1000, mtimeMs / 1000);
	}
	if (faulty.state === "passed") return { state: "missed" };
	if (faulty.state === "expected") return { state: "caught" };
	return { state: "inconclusive", detail: `failed, but not as expected: ${faulty.detail}` };
}

/**
 * The copy as it is now (after setup) recorded in an index of its own in `scratch`, ignored files included, so build
 * output counts; `linked` paths (from the repository's root) aside, since they're the working tree's, shared. Its
 * `restore` puts the copy back: each file that differs from the record is checked out again, and what's new is removed.
 */
function snapshotOf(copy, scratch, linked) {
	const env = { ...process.env, GIT_INDEX_FILE: join(scratch, "snapshot.index") };
	const run = (...args) => execFileSync("git", args, { cwd: copy, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
	const paths = ["--", ".", ...linked.map((path) => `:(exclude,top)${path}`)];
	run("add", "-A", "-f", ...paths);
	return {
		restore() {
			// Changed or deleted since the record: checked out from it again. The record's file stats are refreshed first,
			// so a file put back with the same contents (and its times, by judge) isn't taken for changed and rewritten.
			spawnSync("git", ["update-index", "-q", "--refresh"], { cwd: copy, env, stdio: "ignore" });
			const changed = run("diff-files", "--name-only", "-z", ...paths).split("\0").filter(Boolean);
			for (let i = 0; i < changed.length; i += 500) run("checkout-index", "-f", "-q", "--", ...changed.slice(i, i + 500));
			// New since: removed, a new folder whole.
			for (const path of run("ls-files", "--others", "--directory", "-z", ...paths).split("\0").filter(Boolean)) rmSync(join(copy, path), { recursive: true, force: true });
		},
	};
}

/** The tracked files `touched` put back as the copy's index has them, where a patch changed or a check rewrote them. */
function restoreTouched(copy, touched) {
	const tracked = touched.filter((file) => spawnSync("git", ["ls-files", "--error-unmatch", "--", file], { cwd: copy, stdio: "ignore" }).status === 0);
	if (tracked.length > 0) spawnSync("git", ["checkout-index", "-f", "-q", "--", ...tracked], { cwd: copy, stdio: "ignore" });
	for (const file of touched) if (!tracked.includes(file)) rmSync(join(copy, file), { force: true });
}

/**
 * The files the patch at `patch` touches, as they're named in the copy before it's applied: what `git apply --numstat`
 * lists, and the old path of each rename, which it leaves out but taking the patch out puts back.
 */
function touchedBy(copy, patch) {
	const listed = spawnSync("git", ["apply", "--numstat", "-z", patch], { cwd: copy, encoding: "utf8" }).stdout ?? "";
	const files = listed.split("\0").map((row) => row.split("\t")[2]).filter(Boolean);
	// A missing patch touches nothing: git apply then says it doesn't apply, and the fault is inconclusive.
	const text = existsSync(patch) ? readFileSync(patch, "utf8") : "";
	for (const line of text.split(/\r?\n/)) if (line.startsWith("rename from ")) files.push(unquoted(line.slice("rename from ".length)));
	return files;
}

/** A path as git writes it in a patch: as is, or in double quotes with C escapes (octal bytes for non-ASCII). */
function unquoted(path) {
	if (!path.startsWith('"')) return path;
	const bytes = [];
	const named = { n: 10, t: 9, r: 13, b: 8, f: 12, a: 7, v: 11, '"': 34, "\\": 92 };
	for (let i = 1; i < path.length - 1; i++) {
		if (path[i] !== "\\") bytes.push(...Buffer.from(path[i]));
		else if (/[0-7]/.test(path[i + 1])) bytes.push(parseInt(path.slice(i + 1, (i += 3) + 1), 8));
		else bytes.push(named[path[++i]] ?? path.charCodeAt(i));
	}
	return Buffer.from(bytes).toString("utf8");
}

/** Run `run` from `cwd`: `{ status, error?, output }`, with stdout and stderr together. */
function command(cwd, [program, ...args], timeout) {
	const run = spawnable(program, args, { cwd });
	const result = runBounded(run.file, run.args, { ...run.options, cwd, timeout, capture: true });
	return { status: result.status, error: result.error, output: result.stdout + result.stderr };
}
