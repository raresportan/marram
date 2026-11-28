// TypeScript 7's compiler is native: its JavaScript API (`typescript/unstable/*`) runs the compiler in a child
// process and reads its syntax trees back, where TypeScript 5 parsed in this one. The trees it hands back are close
// to 5's (`kind`, `parent`, `getStart`, `getText`, `forEachChild`, the `is*` guards), so this gives the lints the part
// of 5's API they use, built on 7's: `createSourceFile` and `createProgram` open the files in the child, and a type
// answers `isUnion`, `types`, `getProperty` and `getCallSignatures` through the checker, as 5's do.
//
// The API is marked unstable, and 7.1 already changes it (its modules lose `unstable/`, snapshots are made another way,
// and the file system callbacks take other values), so this is written for 7.0, and `typescript.mjs` loads it only there.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as ast from "typescript/unstable/ast";
import { createScanner, skipTrivia } from "typescript/unstable/ast/scanner";
import { API, ModuleKind, SignatureKind, SymbolFlags, TypeFlags } from "typescript/unstable/sync";

const { SyntaxKind: K } = ast;

// 5's numbering, which 7's API doesn't export.
const ModuleResolutionKind = { Classic: 1, Node10: 2, Node16: 3, NodeNext: 99, Bundler: 100, 1: "Classic", 2: "Node10", 3: "Node16", 99: "NodeNext", 100: "Bundler" };

// Text given to createSourceFile and configs written for createProgram, served to the compiler in place of the disk.
const served = new Map();
let api;
let made = 0;

/** The compiler's process, started on first use. It doesn't hold this one open: its pipes are unreferenced. */
function compiler() {
	api ??= new API({
		cwd: process.cwd(),
		// What `served` doesn't hold (`undefined`) is read from the disk.
		fs: {
			readFile: (file) => served.get(file),
			fileExists: (file) => (served.has(file) ? true : undefined),
		},
	});
	return api;
}

// The extension 7 reads each script kind from: it takes no kind, and a file whose extension names none crashes it.
const EXTENSIONS = { [ast.ScriptKind.TS]: ".ts", [ast.ScriptKind.TSX]: ".tsx", [ast.ScriptKind.JS]: ".js", [ast.ScriptKind.JSX]: ".jsx" };
const KIND_OF = { ".ts": ast.ScriptKind.TS, ".mts": ast.ScriptKind.TS, ".cts": ast.ScriptKind.TS, ".tsx": ast.ScriptKind.TSX, ".js": ast.ScriptKind.JS, ".mjs": ast.ScriptKind.JS, ".cjs": ast.ScriptKind.JS, ".jsx": ast.ScriptKind.JSX };

/**
 * A source file's tree, as 5's createSourceFile parses it: `text`, read as `fileName`, as `kind` (or as the kind its
 * extension says, and as TypeScript's when it says none, as 5 does). A file whose extension isn't its kind's is parsed
 * under its name with that kind's extension added: `rule.es6` as `rule.es6.js`.
 *
 * The text is served only for the parse, and its snapshots are let go once the next parse has its own: a program
 * built later reads the file from the disk, as it is then, and a scan of many files holds one snapshot, not two each.
 */
function createSourceFile(fileName, text, _target, _setParentNodes, kind) {
	const named = resolve(fileName);
	const extension = /\.[^./\\]+$/.exec(named)?.[0]?.toLowerCase();
	const wanted = EXTENSIONS[kind] === undefined ? (KIND_OF[extension] ?? ast.ScriptKind.TS) : kind;
	const file = KIND_OF[extension] === wanted ? named : named + EXTENSIONS[wanted];
	served.set(file, text);
	// Marked changed every time: the compiler may hold this file's text from an earlier parse, or from the disk.
	const snapshot = open({ openFiles: [file], fileChanges: { changed: [file] } });
	settled?.dispose();
	try {
		return snapshot.getDefaultProjectForFile(file).program.getSourceFile(file);
	} finally {
		settled = open({ closeFiles: [file] });
		snapshot.dispose();
		served.delete(file);
	}
}

// The snapshot the last parse ended on, disposed once the next parse has one after it. On 7.0.2, when every snapshot
// is disposed before the next one is made, the next parse of a file gets the text it had then, whatever it's served.
let settled;

// Snapshots made and not yet disposed: each holds the compiler's state for it until it is.
let live = 0;

/** A snapshot of the compiler after `changes`, counted until it's disposed. */
function open(changes) {
	const snapshot = compiler().updateSnapshot(changes);
	live++;
	const dispose = snapshot.dispose.bind(snapshot);
	snapshot.dispose = () => {
		if (!snapshot.isDisposed()) live--;
		dispose();
	};
	return snapshot;
}

// The config a parsed command line came from: createProgram opens it, rather than turning its options back into JSON.
const CONFIG = Symbol("config");

/** 5's getParsedCommandLineOfConfigFile, for createProgram: its files, and options that name the config they're from. */
function getParsedCommandLineOfConfigFile(config, _existing, host) {
	const file = resolve(config);
	if (!existsSync(file)) {
		host?.onUnRecoverableConfigFileDiagnostic?.({ messageText: `Cannot read file '${file}'.` });
		return undefined;
	}
	return { fileNames: compiler().parseConfigFile(file).fileNames, options: { [CONFIG]: file }, errors: [] };
}

/**
 * A program over `rootNames` with `options`, as 5's createProgram builds one: 7 opens programs from a config, so one is
 * written (served, not saved) that lists the files and either holds the options or extends the config they came from.
 */
function createProgram(rootNames, options) {
	const files = rootNames.map((name) => resolve(name));
	const from = options[CONFIG];
	const config = resolve(dirname(from ?? files[0] ?? resolve("index.ts")), `.marram-program-${process.pid}-${made++}.json`);
	served.set(config, JSON.stringify(from === undefined ? { compilerOptions: named(options), files } : { extends: from, files, include: [] }));
	// Files on disk may have changed since an earlier program read them: this one reads them afresh.
	const snapshot = open({ openProjects: [config], fileChanges: { invalidateAll: true } });
	return programOf(snapshot.getProject(config), () => {
		snapshot.dispose();
		open({ closeProjects: [config] }).dispose();
		served.delete(config);
	});
}

// Options 5's createProgram takes as enum members, which a config names.
const ENUMS = { module: ModuleKind, moduleResolution: ModuleResolutionKind, target: ast.ScriptTarget };

/** `options` as a config writes them: `module: ts.ModuleKind.NodeNext` is `"NodeNext"`. */
function named(options) {
	return Object.fromEntries(Object.entries(options).map(([key, value]) => [key, typeof value === "number" && ENUMS[key]?.[value] !== undefined ? ENUMS[key][value] : value]));
}

/** 5's program, over 7's project; `release` lets go of what 7 holds for it (see typescript.mjs's `release`). */
function programOf(project, letGo) {
	const { program } = project;
	let released = false;
	return {
		release() {
			if (released) return;
			released = true;
			letGo();
		},
		getSourceFile: (name) => program.getSourceFile(resolve(name)),
		getSourceFiles: () => program.getSourceFileNames().map((name) => program.getSourceFile(name)),
		getTypeChecker: () => checkerOf(project.checker),
	};
}

/** 5's checker, as far as the lints ask it: types come back with the methods 5's have. */
function checkerOf(checker) {
	const typeOf = (type) => type && {
		flags: type.flags,
		isUnion: () => type.isUnionType(),
		get types() {
			return type.getTypes().map(typeOf);
		},
		getProperty: (name) => checker.getPropertiesOfType(checker.getApparentType(type) ?? type).find((symbol) => symbol.name === name),
		getCallSignatures: () => checker.getSignaturesOfType(type, SignatureKind.Call),
	};
	return {
		getSymbolAtLocation: (node) => checker.getSymbolAtLocation(node),
		getShorthandAssignmentValueSymbol: (node) => checker.getShorthandAssignmentValueSymbol(node),
		getExportsOfModule: (symbol) => checker.getExportsOfModule(symbol),
		getAliasedSymbol: (symbol) => checker.getAliasedSymbol(symbol),
		getTypeAtLocation: (node) => typeOf(checker.getTypeAtLocation(node)),
		getContextualType: (node) => typeOf(checker.getContextualType(node)),
		getReturnTypeOfSignature: (signature) => typeOf(checker.getReturnTypeOfSignature(signature)),
	};
}

// 5's `node.getChildren(source)`: its child nodes, with the tokens between them (`=`, `(`, `;`) that 7's trees leave out,
// and each list of children as one node holding them, as 5 builds them.
const scanner = createScanner(true);

const synthetic = (kind, pos, end, parent, children = []) => ({
	kind, pos, end, parent, children, synthetic: true,
	getFullStart: () => pos,
	getEnd: () => end,
	getStart: (source) => skipTrivia((source ?? parent.getSourceFile()).text, pos),
});

/** The tokens in `pos`…`end` of `parent`, scanned: the gap between two of its children. */
function tokens(into, pos, end, parent) {
	scanner.resetTokenState(pos);
	while (pos < end) {
		const kind = scanner.scan();
		const after = scanner.getTokenEnd();
		if (after <= end) into.push(synthetic(kind, pos, after, parent));
		pos = after;
		if (kind === K.EndOfFile) break;
	}
}

function getChildren(node, source) {
	if (node.synthetic) return node.children;
	// A token (an identifier, a literal, a keyword, a `/…/` pattern) has none, as in 5: its text isn't scanned again.
	if (node.kind < K.FirstNode) return [];
	scanner.setText((source ?? node.getSourceFile()).text);
	const children = [];
	let pos = node.pos;
	node.forEachChild(
		(child) => {
			tokens(children, pos, child.pos, node);
			children.push(child);
			pos = child.end;
		},
		(nodes) => {
			tokens(children, pos, nodes.pos, node);
			const list = [];
			let at = nodes.pos;
			for (const child of nodes) {
				tokens(list, at, child.pos, node);
				list.push(child);
				at = child.end;
			}
			tokens(list, at, nodes.end, node);
			children.push(synthetic(K.SyntaxList, nodes.pos, nodes.end, node, list));
			pos = nodes.end;
		},
	);
	tokens(children, pos, node.end, node);
	scanner.setText(undefined);
	return children;
}

// 5's guards that 7's API doesn't have, by the kinds 5 checks.
const kinds = (...list) => {
	const set = new Set(list);
	return (node) => set.has(node.kind);
};

export default {
	...ast,
	TypeFlags,
	SymbolFlags,
	ModuleKind,
	ModuleResolutionKind,
	ScriptTarget: { ...ast.ScriptTarget, Latest: ast.ScriptTarget.Latest ?? ast.ScriptTarget.ESNext },
	createSourceFile,
	createProgram,
	getParsedCommandLineOfConfigFile,
	sys: {},
	flattenDiagnosticMessageText: (message) => (typeof message === "string" ? message : message?.messageText ?? ""),
	forEachChild: (node, visit) => node.forEachChild(visit),
	getChildren,
	liveSnapshots: () => live,
	isPropertySignature: kinds(K.PropertySignature),
	isMethodSignature: kinds(K.MethodSignature),
	isStringLiteralLike: kinds(K.StringLiteral, K.NoSubstitutionTemplateLiteral),
	isClassElement: kinds(K.Constructor, K.PropertyDeclaration, K.MethodDeclaration, K.GetAccessor, K.SetAccessor, K.IndexSignature, K.ClassStaticBlockDeclaration, K.SemicolonClassElement),
	isTypeElement: kinds(K.ConstructSignature, K.CallSignature, K.PropertySignature, K.MethodSignature, K.IndexSignature, K.GetAccessor, K.SetAccessor, K.NotEmittedTypeElement),
	isFunctionLike: kinds(
		K.MethodSignature, K.CallSignature, K.JSDocSignature, K.ConstructSignature, K.IndexSignature, K.FunctionType, K.JSDocFunctionType, K.ConstructorType,
		K.FunctionDeclaration, K.MethodDeclaration, K.Constructor, K.GetAccessor, K.SetAccessor, K.FunctionExpression, K.ArrowFunction,
	),
};
