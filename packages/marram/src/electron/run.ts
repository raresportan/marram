// Running journeys, and judging them: a journey fails on a failed check, an error, a page error, a polled check nobody
// awaited (it ended before the check was recorded, so it couldn't fail it), or checking nothing (it would pass
// whatever the app does). Journeys run the build, not the sources, so a build older than its sources is refused: a
// source changed since would go untested while its journey passed.
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Check, JourneySession } from "./session.ts";

/** A build: the files it writes, and the files and folders it's made from. */
export interface Build {
	readonly outputs: readonly string[];
	readonly inputs: readonly string[];
}

/** A source file changed since the build that holds it (by path from `root`), if any. A missing output counts as old. */
export function staleInput(root: string, builds: readonly Build[]): string | undefined {
	for (const { outputs, inputs } of builds) {
		const built = Math.min(...outputs.map((file) => (existsSync(file) ? statSync(file).mtimeMs : 0)));
		for (const input of inputs) {
			const files = statSync(input).isDirectory() ? readdirSync(input, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)) : [input];
			const newer = files.find((file) => statSync(file).mtimeMs > built);
			if (newer !== undefined) return relative(root, newer);
		}
	}
	return undefined;
}

export interface Result {
	readonly journey: string;
	readonly checks: readonly Check[];
	readonly error?: string;
	readonly pageErrors: readonly string[];
}

/** Whether a journey's result fails it. */
export const failed = (result: Result): boolean => result.error !== undefined || result.pageErrors.length > 0 || result.checks.some((check) => !check.ok);

/**
 * Run each of `chosen` with a session `open` makes for it (given its evidence folder under `evidence`), and write
 * `report.json` there. Whether they all passed.
 */
export async function runJourneys<S extends JourneySession>({ chosen, run, open, evidence }: {
	chosen: readonly string[];
	run: (journey: string, session: S) => Promise<void>;
	open: (journey: string, evidence: string) => S;
	evidence: string;
}): Promise<boolean> {
	const results: Result[] = [];
	for (const journey of chosen) {
		const session = open(journey, join(evidence, journey));
		console.log(`\n${journey}`);
		let error: string | undefined;
		try {
			await run(journey, session);
		} catch (failure) {
			error = failure instanceof Error ? failure.message : String(failure);
			console.log(`  ✗ ${error}`);
			await session.shot("failure").catch(() => {});
		} finally {
			await session.dispose();
		}
		results.push(judge(journey, session, error));
	}
	const failures = results.filter(failed);
	writeFileSync(join(evidence, "report.json"), JSON.stringify(results, null, 2));
	console.log(`\n${results.length - failures.length}/${results.length} journeys passed. Evidence: ${evidence}`);
	return failures.length === 0;
}

/** A journey's result, from its session once it ended, and the error it ended with, if any. */
export function judge(journey: string, session: Pick<JourneySession, "checks" | "unsettled" | "pageErrors">, thrown: string | undefined): Result {
	let error = thrown;
	if (session.pageErrors.length > 0) console.log(`  ✗ ${session.pageErrors.length} page error(s): ${session.pageErrors[0]}`);
	if (error === undefined && session.unsettled.size > 0) {
		error = `ended with checks nobody awaited: ${[...session.unsettled].join("; ")}`;
		console.log(`  ✗ ${error}`);
	}
	if (error === undefined && session.checks.length === 0) {
		error = "checked nothing";
		console.log(`  ✗ ${error}`);
	}
	return { journey, checks: [...session.checks], ...(error === undefined ? {} : { error }), pageErrors: [...session.pageErrors] };
}
