export interface Check {
	readonly label: string;
	readonly ok: boolean;
	readonly detail?: string;
}
export interface JourneyEvidence {
	readonly checks: readonly Check[];
	readonly unsettled?: ReadonlySet<string>;
	readonly pageErrors?: readonly string[];
	shot?(name: string): Promise<void>;
	dispose?(): void | Promise<void>;
}
/** A build: the files it writes, and the files and folders it's made from. */
export interface Build {
	readonly outputs: readonly string[];
	readonly inputs: readonly string[];
}
/** A source file changed since the build that holds it (by path from `root`), if any. A missing output counts as old. */
export declare function staleInput(root: string, builds: readonly Build[]): string | undefined;
export interface Result {
	readonly journey: string;
	readonly checks: readonly Check[];
	readonly error?: string;
	/** Why its session couldn't be closed, which fails the journey too. */
	readonly cleanup?: string;
	readonly pageErrors: readonly string[];
}
/** Whether a journey's result fails it. */
export declare const failed: (result: Result) => boolean;
/**
 * Run each of `chosen` with a session `open` makes for it (given its evidence folder under `evidence`), and write
 * `report.json` there. Whether they all passed.
 */
export declare function runJourneys<S extends JourneyEvidence>({ chosen, run, open, evidence, featureMap }: {
	chosen: readonly string[];
	run: (journey: string, session: S) => Promise<void>;
	open: (journey: string, evidence: string) => S;
	evidence: string;
	featureMap?: {
		path: string;
		custom?: readonly RegExp[];
	};
}): Promise<boolean>;
/** A journey's result, from its session once it ended, and the error it ended with, if any. */
export declare function judge(journey: string, session: Pick<JourneyEvidence, "checks" | "unsettled" | "pageErrors">, thrown: string | undefined): Result;
