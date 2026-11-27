#!/usr/bin/env node
// Usage:
//   marram gate [fast | full]                  run the project's gate (src/gate.mjs)
//   (gate, probe, guard-diff and review-summary take --json: their result as JSON on stdout, what they say on stderr)
//   marram hook <mode>                         the gate where work is declared done (src/hook.mjs)
//   marram commit-lint <message file>          a review fix names each finding's class and rung (src/commit-lint.mjs)
//   marram commit-lint --range <from>..<to>
//   marram probe [fault]…                     does the gate still catch the defects it was built to catch (src/core/probe.mjs)
//   marram guard-diff <base> [--map <map>]…   what a branch changed in the checks that judge it (src/core/guard-diff.mjs)
//   marram init                               set a project up: config, logs ignored, pre-push hook (src/core/init.mjs)
//   marram doctor                             what's missing or wrong in the setup (src/core/doctor.mjs)
import { lintCommits } from "../src/core/commit-lint.mjs";
import { probe } from "../src/core/probe.mjs";
import { replay } from "../src/core/replay.mjs";
import { reviewSummary } from "../src/core/review-summary.mjs";
import { load } from "../src/core/config.mjs";
import { mapDiff } from "../src/core/map-diff.mjs";
import { guardDiff } from "../src/core/guard-diff.mjs";
import { gate } from "../src/core/gate.mjs";
import { hook } from "../src/core/hook.mjs";
import { init } from "../src/core/init.mjs";
import { doctor } from "../src/core/doctor.mjs";
import { exitWhenWritten } from "../src/core/json-output.mjs";

const [command, ...args] = process.argv.slice(2);
const commands = { gate, hook, probe, replay, "map-diff": mapDiff, "commit-lint": lintCommits, "review-summary": reviewSummary };
// guard-diff starts from the repository: a project's configuration may be what the branch deleted or broke.
if (command === "guard-diff") {
	await guardDiff(process.cwd(), args);
	await exitWhenWritten(0);
}
// init sets up what isn't there yet, and doctor reports on a config that may not load.
if (command === "init" || command === "doctor") {
	await (command === "init" ? init : doctor)(process.cwd());
	await exitWhenWritten(0);
}
if (!(command in commands)) {
	console.error("Usage: marram init | marram doctor | marram probe [fault]… | marram guard-diff <base> [--map <map>]… | marram replay <base> <test-file> <test-name> <expected assertion message> | marram replay <base> <test-file> --expect <text> -- <command>… | marram map-diff <base> <map> | marram gate [fast | full] | marram hook <mode> | marram commit-lint <message file> | --range <from>..<to> | marram review-summary [--since <ref>] (gate, probe, guard-diff and review-summary take --json)");
	process.exit(1);
}
// A config with problems is reported as what to fix, not as a crash.
const { root, config } = await load().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
await commands[command](root, config, args);
