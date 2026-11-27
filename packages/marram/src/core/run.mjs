// Running journeys, and judging them: a journey fails on a failed check, an error, a page error, a polled check nobody
// awaited (it ended before the check was recorded, so it couldn't fail it), or checking nothing (it would pass
// whatever the app does). Journeys run the build, not the sources, so a build older than its sources is refused: a
// source changed since would go untested while its journey passed.
import { mkdirSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { mapCitations } from "./map-citations.mjs";

/** A source file changed since the build that holds it (by path from `root`), if any. A missing output counts as old. */
export function staleInput(root, builds) {
	for (const { outputs, inputs } of builds) {
		const built = Math.min(...outputs.map((file) => (existsSync(file) ? statSync(file).mtimeMs : 0)));
		for (const input of inputs) {
			const files = statSync(input).isDirectory() ? readdirSync(input, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)) : [input];
			const newer = files.find((file) => statSync(file).mtimeMs > built);
			if (newer !== undefined)
				return relative(root, newer);
		}
	}
	return undefined;
}

/** Whether a journey's result fails it. */
export const failed = (result) => result.error !== undefined || result.cleanup !== undefined || result.pageErrors.length > 0 || result.checks.some((check) => !check.ok);

/** A thrown value's message. */
const messageOf = (thrown) => (thrown instanceof Error ? thrown.message : String(thrown));

/**
 * Run each of `chosen` with a session `open` makes for it (given its evidence folder under `evidence`), and write
 * `report.json` there. Whether they all passed.
 */
export async function runJourneys({ chosen, run, open, evidence, featureMap }) {
	mkdirSync(evidence, { recursive: true });
	const results = [];
	for (const journey of chosen) {
		console.log(`\n${journey}`);
		// A session that can't be opened, or closed, fails its journey, and the run goes on to the next one and its report.
		let session;
		try {
			session = open(journey, join(evidence, journey));
		} catch (failure) {
			const error = `couldn't open its session: ${messageOf(failure)}`;
			console.log(`  ✗ ${error}`);
			results.push({ journey, checks: [], error, pageErrors: [] });
			continue;
		}
		let error;
		try {
			await run(journey, session);
		} catch (failure) {
			error = messageOf(failure);
			console.log(`  ✗ ${error}`);
			// Evidence is best effort: a session's shot may throw, or not return a promise at all.
			await Promise.resolve().then(() => session.shot?.("failure")).catch(() => {});
		}
		let cleanup;
		try {
			await session.dispose?.();
		} catch (failure) {
			// It may have left a window or a process behind.
			cleanup = messageOf(failure);
			console.log(`  ✗ couldn't close its session: ${cleanup}`);
		}
		const result = judge(journey, session, error);
		results.push(cleanup === undefined ? result : { ...result, cleanup });
	}
	const missing = [];
	if (featureMap) {
		// Without g or y: with either, test() starts where the last match ended, and a citation after one it matched is missed.
		const custom = (featureMap.custom ?? []).map((pattern) => new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, "")));
		for (const { feature, citation } of mapCitations(readFileSync(featureMap.path, "utf8"))) {
			if (custom.some((pattern) => pattern.test(citation)))
				continue;
			const match = /^([\w-]+)(?: › "(.+)")?$/.exec(citation);
			const result = results.find((row) => row.journey === match?.[1]);
			const label = match?.[2];
			if (result && !failed(result) && (!label || result.checks.some((check) => check.ok && check.label === label)))
				continue;
			const observed = result?.checks.filter((check) => check.ok).map((check) => check.label).join(", ");
			missing.push(`${feature} expected ${citation}. Passed checks: ${observed || "(none)"}`);
		}
		writeFileSync(join(evidence, "missing-citations.json"), JSON.stringify(missing, null, 2));
		for (const problem of missing)
			console.error(`  ✗ ${problem}`);
	}
	const failures = results.filter(failed);
	writeFileSync(join(evidence, "report.json"), JSON.stringify(results, null, 2));
	console.log(`\n${results.length - failures.length}/${results.length} journeys passed. Evidence: ${evidence}`);
	return failures.length === 0 && missing.length === 0;
}

/** A journey's result, from its session once it ended, and the error it ended with, if any. */
export function judge(journey, session, thrown) {
	let error = thrown;
	if (session.pageErrors?.length)
		console.log(`  ✗ ${session.pageErrors.length} page error(s): ${session.pageErrors[0]}`);
	if (error === undefined && session.unsettled?.size) {
		error = `ended with checks nobody awaited: ${[...session.unsettled].join("; ")}`;
		console.log(`  ✗ ${error}`);
	}
	if (error === undefined && session.checks.length === 0) {
		error = "checked nothing";
		console.log(`  ✗ ${error}`);
	}
	return { journey, checks: [...session.checks], ...(error === undefined ? {} : { error }), pageErrors: [...(session.pageErrors ?? [])] };
}
