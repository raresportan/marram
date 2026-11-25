type Journeys = Record<string, {
	readonly run: (session: never) => Promise<void>;
}>;
/** Another kind of citation: what it looks like, and what's wrong with one (undefined when what it names exists). */
export interface Citation {
	readonly pattern: RegExp;
	readonly broken: (match: RegExpExecArray) => string | undefined;
}
/**
 * The map's problems, and how many features it has and how many have gaps. `folder` holds the journey sources, whose
 * functions not named by a journey are helpers, so their checks count for every journey.
 */
export declare function readFeatureMap({ map, folder, journeys, citations, session }: {
	map: string;
	folder: string;
	journeys: Journeys;
	citations?: readonly Citation[];
	session?: string;
}): {
	broken: string[];
	unmarked: string[];
	features: number;
	gaps: number;
};
/** The feature-map journey's checks: every citation resolves, and every feature says how it's verified. */
export declare function checkFeatureMap(session: {
	check(label: string, ok: boolean, detail?: string): void;
}, options: Parameters<typeof readFeatureMap>[0]): void;
export {};
