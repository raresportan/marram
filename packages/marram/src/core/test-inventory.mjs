// The tests a test file declares, read from its source without running it: each one's name (within its suites or
// class), whether it's skipped, and how many assertions its body makes. guard-diff compares them across revisions, so
// a test removed, skipped or emptied of its assertions shows up in review. It reads what's written: a skip decided as
// the test runs, or an assertion made in a helper it calls, isn't seen.
import { posix } from "node:path";

/** "js", "python" or "go" for a file it can read, by extension. */
function languageOf(path) {
	if (/\.[mc]?[jt]sx?$/.test(path)) return "js";
	if (path.endsWith(".py")) return "python";
	if (path.endsWith(".go")) return "go";
	return undefined;
}

/** Whether `path` (from the repository root) is a test file by the usual names, in a language it can read. */
export function isTestFile(path) {
	const language = languageOf(path);
	if (language === undefined) return false;
	if (language === "go") return path.endsWith("_test.go");
	const name = posix.basename(path);
	if (/\.(test|spec)\.[^.]+$/.test(name) || /^test_.*\.py$/.test(name) || /_test\.py$/.test(name)) return true;
	return path.split("/").slice(0, -1).some((folder) => ["test", "tests", "__tests__", "spec"].includes(folder));
}

/**
 * `[{ name, key, skipped, assertions }]` for the tests in `source`, in order, or undefined for a language it can't read.
 * `key` tells a test apart from another of the same name: its name and which occurrence of that name it is.
 */
export function testsIn(path, source) {
	const language = languageOf(path);
	if (language === undefined) return undefined;
	const tests = { js: javascript, python, go }[language](source);
	const seen = new Map();
	return tests.map((found) => {
		const count = (seen.get(found.name) ?? 0) + 1;
		seen.set(found.name, count);
		return { ...found, key: JSON.stringify([found.name, count]) };
	});
}

const OPEN = "\u0002";
const CLOSE = "\u0003";

/**
 * `source` with its comments taken out, each string or template literal replaced by OPEN + its index + CLOSE, and each
 * regular expression literal by "R", so brackets and calls can be found in what's left. `strings` holds the literals'
 * text. A template's `${…}` stays in its text.
 */
function masked(source) {
	let code = "";
	const strings = [];
	let i = 0;
	const previous = () => code.trimEnd().slice(-1);
	const previousWord = () => /(\w+)\s*$/.exec(code)?.[1];
	while (i < source.length) {
		const c = source[i];
		const next = source[i + 1];
		if (c === "/" && next === "/") {
			while (i < source.length && source[i] !== "\n") i++;
		} else if (c === "/" && next === "*") {
			const end = source.indexOf("*/", i + 2);
			i = end === -1 ? source.length : end + 2;
			code += " ";
		} else if (c === '"' || c === "'") {
			let text = "";
			for (i++; i < source.length && source[i] !== c && source[i] !== "\n"; i++) text += source[i] === "\\" ? source[++i] : source[i];
			i++;
			code += OPEN + (strings.push(text) - 1) + CLOSE;
		} else if (c === "`") {
			let text = "";
			for (i++; i < source.length && source[i] !== "`"; i++) {
				if (source[i] === "\\") text += source[++i];
				else if (source[i] === "$" && source[i + 1] === "{") {
					let depth = 0;
					do {
						if (source[i] === "{") depth++;
						else if (source[i] === "}") depth--;
						text += source[i++];
					} while (i < source.length && depth > 0);
					i--;
				} else text += source[i];
			}
			i++;
			code += OPEN + (strings.push(text) - 1) + CLOSE;
		} else if (c === "/" && (previous() === "" || "(,=:[!&|?{};+-*%<>~^".includes(previous()) || ["return", "typeof", "case", "in", "of", "new", "delete", "void", "throw", "yield", "await", "else", "do"].includes(previousWord()))) {
			let inClass = false;
			for (i++; i < source.length && source[i] !== "\n"; i++) {
				if (source[i] === "\\") i++;
				else if (source[i] === "[") inClass = true;
				else if (source[i] === "]") inClass = false;
				else if (source[i] === "/" && !inClass) break;
			}
			for (i++; /[a-z]/.test(source[i] ?? ""); i++);
			code += "R";
		} else {
			code += c;
			i++;
		}
	}
	return { code, strings };
}

/** The index of the bracket that closes the one at `open` in masked code, or the end. */
function closing(code, open) {
	const [opener, closer] = code[open] === "{" ? ["{", "}"] : ["(", ")"];
	let depth = 0;
	for (let i = open; i < code.length; i++) {
		if (code[i] === opener) depth++;
		else if (code[i] === closer && --depth === 0) return i;
	}
	return code.length;
}

const count = (text, pattern) => text.match(pattern)?.length ?? 0;

/** node:test, Jest, Vitest and Mocha: describe, suite, context, test, it and specify, with .skip, .todo, x and { skip }. */
function javascript(source) {
	const { code, strings } = masked(source);
	const calls = [];
	const call = new RegExp(`\\b(x?)(describe|suite|context|test|it|specify)((?:\\s*\\.\\s*\\w+)*)\\s*\\(\\s*${OPEN}(\\d+)${CLOSE}`, "g");
	for (const match of code.matchAll(call)) {
		const chain = match[3].split(".").map((part) => part.trim()).filter(Boolean);
		if (chain.includes("each")) continue;
		const open = match.index + match[0].lastIndexOf("(");
		const close = closing(code, open);
		const nameEnd = match.index + match[0].length;
		// Options come before the function: { skip: … } or { todo: … }, unless it's false.
		const head = code.slice(nameEnd, close).split(/=>|\bfunction\b/)[0];
		const optionSkip = /\b(skip|todo)\s*:(?!\s*(?:false|0|null|undefined)\b)/.test(head);
		calls.push({
			suite: ["describe", "suite", "context"].includes(match[2]),
			name: strings[Number(match[4])],
			open,
			close,
			skipped: match[1] === "x" || chain.includes("skip") || chain.includes("todo") || optionSkip,
			assertions: count(code.slice(open, close), /\b(?:assert(?:\.\w+)?|expect)\s*\(/g),
		});
	}
	return calls.filter((found) => !found.suite).map((found) => {
		const around = calls.filter((other) => other !== found && other.open < found.open && found.close <= other.close);
		return {
			name: [...around.map((other) => other.name), found.name].join(" › "),
			skipped: found.skipped || around.some((other) => other.skipped),
			assertions: found.assertions,
		};
	});
}

/** Go: func TestX(t *testing.T), skipped by a t.Skip in its body, its assertions t.Error…, t.Fatal…, assert. and require. */
function go(source) {
	const { code } = masked(source);
	const tests = [];
	for (const match of code.matchAll(/\bfunc\s+(Test\w*)\s*\(\s*(\w+)\s+\*testing\.T\s*\)\s*\{/g)) {
		const open = match.index + match[0].length - 1;
		const body = code.slice(open, closing(code, open));
		const t = match[2];
		tests.push({
			name: match[1],
			skipped: new RegExp(`\\b${t}\\.Skip(?:Now|f)?\\(`).test(body),
			assertions: count(body, new RegExp(`\\b${t}\\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\\(`, "g")) + count(body, /\b(?:assert|require)\.\w+\(/g),
		});
	}
	return tests;
}

/** pytest and unittest: def test_… at the top or in a class, skipped by a skip, skipif or xfail decorator on it or its class. */
function python(source) {
	const lines = pythonLines(source);
	const tests = [];
	const classes = [];
	let decorators = [];
	const skips = (list) => list.some((decorator) => /\b(skip|skipif|skipIf|skipUnless|xfail)\b/.test(decorator));
	for (let i = 0; i < lines.length; i++) {
		const { indent, text } = lines[i];
		while (classes.length > 0 && classes.at(-1).indent >= indent) classes.pop();
		if (text.startsWith("@")) {
			decorators.push(text);
			continue;
		}
		const klass = /^class\s+(\w+)/.exec(text);
		if (klass) {
			classes.push({ name: klass[1], indent, skipped: skips(decorators) || classes.some((outer) => outer.skipped) });
		} else {
			const def = /^(?:async\s+)?def\s+(test\w*)\s*\(/.exec(text);
			if (def) {
				let end = i + 1;
				while (end < lines.length && lines[end].indent > indent) end++;
				const body = lines.slice(i + 1, end).map((line) => line.text);
				tests.push({
					name: [...classes.map((outer) => outer.name), def[1]].join(" › "),
					skipped: skips(decorators) || classes.some((outer) => outer.skipped),
					assertions: body.filter((line) => /^assert\b/.test(line)).length + body.reduce((sum, line) => sum + count(line, /\b(?:self\.assert\w*|self\.fail|pytest\.raises|pytest\.fail)\s*\(/g), 0),
				});
			}
		}
		decorators = [];
	}
	return tests;
}

/** `source`'s lines that hold code, each with its indent and its text without comments or triple-quoted strings. */
function pythonLines(source) {
	const lines = [];
	let triple;
	for (const raw of source.split(/\r?\n/)) {
		let text = "";
		let quote;
		for (let i = 0; i < raw.length; i++) {
			const three = raw.slice(i, i + 3);
			if (triple) {
				if (three === triple) {
					triple = undefined;
					i += 2;
				}
			} else if (quote) {
				text += raw[i];
				if (raw[i] === "\\") text += raw[++i] ?? "";
				else if (raw[i] === quote) quote = undefined;
			} else if (three === '"""' || three === "'''") {
				triple = three;
				i += 2;
			} else if (raw[i] === "#") {
				break;
			} else {
				if (raw[i] === '"' || raw[i] === "'") quote = raw[i];
				text += raw[i];
			}
		}
		if (text.trim() === "") continue;
		lines.push({ indent: text.length - text.trimStart().length, text: text.trim() });
	}
	return lines;
}
