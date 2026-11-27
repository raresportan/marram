#!/usr/bin/env node
// Usage:
//   marram gate [fast | full]                  run the project's gate (src/gate.mjs)
//   marram hook <mode>                         the gate where work is declared done (src/hook.mjs)
//   marram commit-lint <message file>          a review fix names each finding's class and rung (src/commit-lint.mjs)
//   marram commit-lint --range <from>..<to>
//   marram probe [fault]…                     does the gate still catch the defects it was built to catch (src/core/probe.mjs)
//   marram guard-diff <base> [--map <map>]…   what a branch changed in the checks that judge it (src/core/guard-diff.mjs)
import { lintCommits } from "../src/core/commit-lint.mjs";
import { probe } from "../src/core/probe.mjs";
import { replay } from "../src/core/replay.mjs";
import { reviewSummary } from "../src/core/review-summary.mjs";
import { load } from "../src/core/config.mjs";
import { mapDiff } from "../src/core/map-diff.mjs";
import { guardDiff } from "../src/core/guard-diff.mjs";
import { gate } from "../src/core/gate.mjs";
import { hook } from "../src/core/hook.mjs";

const [command, ...args] = process.argv.slice(2);
const commands = { gate, hook, probe, replay, "map-diff": mapDiff, "commit-lint": lintCommits, "review-summary": reviewSummary };
// guard-diff starts from the repository: a project's configuration may be what the branch deleted or broke.
if (command === "guard-diff") {
	await guardDiff(process.cwd(), args);
	process.exit(0);
}
if (!(command in commands)) {
	console.error("Usage: marram probe [fault]… | marram guard-diff <base> [--map <map>]… | marram replay <base> <test-file> <test-name> <expected assertion message> | marram map-diff <base> <map> | marram gate [fast | full] | marram hook <mode> | marram commit-lint <message file> | --range <from>..<to> | marram review-summary [--since <ref>]");
	process.exit(1);
}
// A config with problems is reported as what to fix, not as a crash.
const { root, config } = await load().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
await commands[command](root, config, args);
