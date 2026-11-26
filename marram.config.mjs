// What Marram's own gate runs. Tally, the example, is a second project on these packages: its gate is part of this one.
const npm = (name, ...args) => ({ name, run: ["npm", ...args] });
// The package's TypeScript is compiled first: Tally, like any project on it, imports what it publishes.
const fast = [npm("build", "run", "build", "-w", "@raresportan/marram"), npm("typecheck", "run", "typecheck"), npm("unit", "test"), { name: "independent", run: ["node", "scripts/independent.mjs"] }];
const tally = (tier) => ({ name: "tally", run: ["npm", "run", tier, "-w", "tally"] });

export default {
	gate: {
		logs: ".verify",
		tiers: { fast: [...fast, tally("gate:fast")], default: [...fast, tally("gate")], full: [...fast, tally("gate:full"), npm("probes", "run", "probes")] },
	},
	// Known defects each guard was built to catch, put back one at a time in a copy of the working tree (marram probe).
	probes: {
		link: ["node_modules"],
		setup: ["npm", "run", "build", "-w", "@raresportan/marram", "-w", "tally"],
		// Tally's build and journeys can take minutes on a cold CI machine.
		timeoutMs: Number(process.env.PROBE_TIMEOUT_MS) || 300_000,
		faults: [
			{
				name: "nested projects must run their own gate",
				patch: "probes/nested-project-verdict.patch",
				test: { file: "packages/marram/test/core/hook.test.mjs", name: "a nested project's full pass cannot satisfy the root project's finish hook", assertion: "finish must run the root project's stage" },
			},
			{
				name: "an IPC operation requires a host handler",
				patch: "probes/missing-ipc-handler.patch",
				cwd: "examples/tally",
				run: ["npm", "run", "typecheck"],
				expect: /error TS2345:[\s\S]*Property 'increment' is missing/,
			},
			{
				name: "the counting journey must observe persistence after restart",
				patch: "probes/uncalled-restart-check.patch",
				cwd: "examples/tally",
				run: ["npm", "run", "verify"],
				expect: /expected counts › "The count survives a restart"\. Passed checks: It starts at zero, One click counts one/,
			},
		],
	},
	review: { classes: "docs/mistake-classes.md" },
};
