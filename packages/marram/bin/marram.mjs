#!/usr/bin/env node
// Usage:
//   marram gate [fast | full]                  run the project's gate (src/gate.mjs)
//   marram hook <mode>                         the gate where work is declared done (src/hook.mjs)
//   marram commit-lint <message file>          a review fix names each finding's class and rung (src/commit-lint.mjs)
//   marram commit-lint --range <from>..<to>
import { lintCommits } from "../src/core/commit-lint.mjs";
import { replay } from "../src/core/replay.mjs";
import { reviewSummary } from "../src/core/review-summary.mjs";
import { load } from "../src/core/config.mjs";
import { mapDiff } from "../src/electron/map-diff.mjs";
import { gate } from "../src/core/gate.mjs";
import { hook } from "../src/core/hook.mjs";

const [command, ...args] = process.argv.slice(2);
const commands = { gate, hook, replay, "map-diff": mapDiff, "commit-lint": lintCommits, "review-summary": reviewSummary };
if (!(command in commands)) {
	console.error("Usage: marram replay <base> <test-file> <test-name> <expected assertion message> | marram map-diff <base> <map> | marram gate [fast | full] | marram hook <mode> | marram commit-lint <message file> | --range <from>..<to> | marram review-summary [--since <ref>]");
	process.exit(1);
}
const { root, config } = await load();
await commands[command](root, config, args);
