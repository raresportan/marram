// What Tally's gate runs.
const npm = (name, ...args) => ({ name, run: ["npm", ...args] });
const fast = [npm("typecheck", "run", "typecheck"), npm("rules", "run", "rules")];
const standard = [...fast, npm("unit", "test"), npm("feature-map", "run", "verify", "--", "feature-map")];

export default {
	gate: {
		logs: ".verify",
		progress: /journeys passed/,
		tiers: { fast, default: standard, full: [...standard, npm("build", "run", "build"), npm("journeys", "run", "verify")] },
	},
	review: { classes: "docs/mistake-classes.md" },
};
