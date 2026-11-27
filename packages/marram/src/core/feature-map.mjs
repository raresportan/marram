// A feature map is "materialized memory" (Lauren Tan's term): every feature the app has, how a user reaches it, and
// what verifies it, so an agent can read a vague bug report against it. It stays honest only if checked: every check it
// cites must exist, and every feature must say how it's verified.
//
// Each feature is a `- **Name**` bullet followed by status lines: `✅ <journey> › "<check name>"`, `✅ <journey>` (the
// whole journey), a project's own citations (`✅ server › <script>.ts`), or `❌ <why it isn't verified>`.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { featureOf, mapLines, statusOf } from "./map-citations.mjs";

/** Check names per function in the journey sources (`<session>.check("…")`); `${…}` in a name matches anything. */
function checksByFunction(folder, session) {
	const byFunction = new Map();
	const call = new RegExp(`${session}\\.check\\(\\s*(["\`])([\\s\\S]*?)\\1`, "g");
	for (const file of readdirSync(folder).filter((name) => /\.[cm]?[jt]s$/.test(name))) {
		const source = readFileSync(join(folder, file), "utf8");
		const starts = [...source.matchAll(/^(?:export )?async function (\w+)\(/gm)];
		starts.forEach((start, index) => {
			const body = source.slice(start.index, starts[index + 1]?.index ?? source.length);
			const names = [...body.matchAll(call)].map(([, , name]) => {
				const pattern = name.split(/\$\{[^}]*\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+");
				return new RegExp(`^${pattern}$`);
			});
			byFunction.set(start[1], names);
		});
	}
	return byFunction;
}

/** What's wrong with a `✅` line's citation, or undefined when it names something that exists. */
function brokenCitation(cited, journeys, checksOf, citations) {
	for (const { pattern, broken } of citations) {
		const match = pattern.exec(cited);
		if (match !== null)
			return broken(match);
	}
	const [, journey, check] = /^([\w-]+)(?: › "(.+)")?$/.exec(cited) ?? [];
	if (journey === undefined || journeys[journey] === undefined)
		return `no journey in "${cited}"`;
	if (check !== undefined && !checksOf(journey).some((pattern) => pattern.test(check)))
		return `${journey} has no check "${check}"`;
	return undefined;
}

/**
 * The map's problems, and how many features it has and how many have gaps. `folder` holds the journey sources, whose
 * functions not named by a journey are helpers, so their checks count for every journey.
 */
export function readFeatureMap({ map, folder, journeys, citations = [], session = "session" }) {
	const byFunction = checksByFunction(folder, session);
	// Without g or y: with either, exec starts where the last match ended, so a citation matching after one that did
	// would be missed, and read as a journey's.
	citations = citations.map(({ pattern, broken }) => ({ pattern: new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, "")), broken }));
	const isJourney = (name) => Object.values(journeys).some((journey) => journey.run.name === name);
	const helpers = [...byFunction].filter(([name]) => !isJourney(name)).flatMap(([, names]) => names);
	const checksOf = (journey) => [...(byFunction.get(journeys[journey].run.name) ?? []), ...helpers];
	const broken = [];
	const features = [];
	for (const [index, line] of mapLines(readFileSync(map, "utf8")).entries()) {
		const feature = featureOf(line);
		const status = statusOf(line);
		if (feature !== undefined)
			features.push({ name: feature, statuses: [] });
		else if (status === undefined)
			continue;
		else if (features.length === 0)
			broken.push(`line ${index + 1}: a status outside any feature`);
		else {
			features.at(-1).statuses.push(status.mark);
			const problem = status.mark === "✅" ? brokenCitation(status.text, journeys, checksOf, citations) : undefined;
			if (problem !== undefined)
				broken.push(`line ${index + 1}: ${problem}`);
		}
	}
	return {
		broken,
		unmarked: features.filter((feature) => feature.statuses.length === 0).map((feature) => feature.name),
		features: features.length,
		gaps: features.filter((feature) => feature.statuses.includes("❌")).length,
	};
}

/** The feature-map journey's checks: every citation resolves, and every feature says how it's verified. */
export function checkFeatureMap(session, options) {
	const { broken, unmarked, features, gaps } = readFeatureMap(options);
	session.check("Every check the feature map cites exists", broken.length === 0, broken.slice(0, 10).join("; "));
	session.check("Every feature in the map says how it is verified", unmarked.length === 0, unmarked.slice(0, 10).join(", "));
	console.log(`  ${features} features: ${features - gaps} verified, ${gaps} with gaps (❌ in ${relative(process.cwd(), options.map)})`);
}
