#!/usr/bin/env node
// Marram knows nothing of the projects that use it: they depend on it, never the other way. So no tracked file names one.
// The names are in .independent-names, one per line, which isn't tracked, so this repository doesn't name them either.
// Without that file, as in a fresh clone, there's nothing to look for and this says so.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const FILE = ".independent-names";
const names = existsSync(FILE) ? readFileSync(FILE, "utf8").split("\n").map((name) => name.trim()).filter(Boolean) : [];
if (names.length === 0) {
	console.log(`ok: no ${FILE} here, so nothing to look for`);
	process.exit(0);
}
let found = "";
try {
	found = execFileSync("git", ["grep", "-inwE", names.join("|")], { encoding: "utf8" });
} catch (error) {
	if (error.status !== 1) throw error;
}
if (found !== "") {
	console.error(`independent: these name a project that uses Marram, which Marram must not know about:\n${found}`);
	process.exit(1);
}
console.log(`ok: no file names any of the ${names.length} projects in ${FILE}`);
