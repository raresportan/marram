// A comment explaining a workaround reads as permission to work around: agents copy it, and it spreads. So a project can
// ban comments, as a finder for `restrict`. What stays is what no code can say: a doc comment on a declaration, a license
// header at the top of a file, and a comment with a link to the outside constraint it explains.
import ts from "typescript";

const isDocComment = (text) => text.startsWith("/**");
const hasLink = (text) => /https?:\/\//.test(text);
const isLicense = (text, pos) => pos === 0 && /\b(license|copyright|spdx)\b/i.test(text);

/** A declaration a reader looks up: in a module, a class, an interface or an object, not in a function's body. */
function documents(node) {
	const declares = ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)
		|| ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node) || ts.isVariableStatement(node)
		|| ts.isExportAssignment(node) || ts.isExportDeclaration(node) || ts.isEnumMember(node) || ts.isClassElement(node)
		|| ts.isTypeElement(node) || ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node);
	if (!declares) return false;
	for (let up = node.parent; up !== undefined; up = up.parent) if (ts.isFunctionLike(up)) return false;
	return true;
}

/** The comments in `source` that aren't allowed, as `{ line, what }`, for `restrict`. */
export function comments(source) {
	// One comment leads every node that starts after it, so it's a doc comment if any of them is a declaration.
	const ranges = new Map();
	const look = (found, doc) => {
		for (const { pos, end } of found ?? []) {
			const range = ranges.get(pos) ?? { pos, end, doc: false };
			range.doc ||= doc;
			ranges.set(pos, range);
		}
	};
	// Through every token as well as every node: a comment after `=` or `(` trails a token, not a node.
	const visit = (node) => {
		look(ts.getLeadingCommentRanges(source.text, node.getFullStart()), documents(node));
		look(ts.getTrailingCommentRanges(source.text, node.getEnd()), false);
		for (const child of node.getChildren(source)) visit(child);
	};
	visit(source);
	return [...ranges.values()]
		.sort((a, b) => a.pos - b.pos)
		.filter(({ pos, end, doc }) => {
			const text = source.text.slice(pos, end);
			return !(doc && isDocComment(text)) && !hasLink(text) && !isLicense(text, pos);
		})
		.map(({ pos }) => ({ line: source.getLineAndCharacterOfPosition(pos).line + 1, what: "has a comment" }));
}
