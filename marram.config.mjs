// What Marram's own gate runs. Tally, the example, is a second project on these packages: its gate is part of this one.
const npm = (name, ...args) => ({ name, run: ["npm", ...args] });
const fast = [npm("typecheck", "run", "typecheck"), npm("unit", "test"), { name: "independent", run: ["node", "scripts/independent.mjs"] }];
const tally = (tier) => ({ name: "tally", run: ["npm", "run", tier, "-w", "tally"] });

export default {
	gate: {
		logs: ".verify",
		tiers: { fast: [...fast, tally("gate:fast")], default: [...fast, tally("gate")], full: [...fast, tally("gate:full")] },
	},
	review: { classes: "docs/mistake-classes.md" },
};
