// Runs Tally's journeys against its build. Usage: npm run verify -w tally -- [<journey>...] [--stale] [--keep]
import { join } from "node:path";
import { runJourneys, staleInput } from "@raresportan/marram/electron/run";
import { Session, TALLY } from "./harness.ts";
import { JOURNEYS } from "./journeys.ts";

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const named = args.filter((arg) => !arg.startsWith("--"));
const chosen = named.length === 0 ? Object.keys(JOURNEYS) : named;
const unknown = chosen.filter((name) => !(name in JOURNEYS));
if (unknown.length > 0) {
	console.error(`No journey ${unknown.join(", ")}. Journeys: ${Object.keys(JOURNEYS).join(", ")}`);
	process.exit(1);
}

const REPO = join(TALLY, "..", "..");
const BUILDS = [{
	outputs: [join(TALLY, "out", "main", "index.js"), join(TALLY, "out", "preload", "index.cjs"), join(TALLY, "out", "renderer", "index.html")],
	inputs: [join(TALLY, "src"), join(REPO, "packages", "marram", "src"), join(TALLY, "electron.vite.config.ts")],
}];
const changed = chosen.some((journey) => JOURNEYS[journey]!.app) ? staleInput(REPO, BUILDS) : undefined;
if (changed !== undefined && !flags.has("--stale")) {
	console.error(`The build is older than ${changed}. Run npm run build -w tally, or pass --stale to run the old build.`);
	process.exit(1);
}

const passed = await runJourneys<Session>({
	chosen,
	run: (journey, session) => JOURNEYS[journey]!.run(session),
	open: (journey, evidence) => new Session(journey, { evidence, keep: flags.has("--keep"), osCapture: false }),
	evidence: join(TALLY, ".verify", new Date().toISOString().replace(/[:.]/g, "-")),
});
process.exit(passed ? 0 : 1);
