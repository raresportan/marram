// A comment explaining a workaround reads as permission to work around: agents copy it, and it spreads. So a project can
// ban comments, as a finder for `restrict`. What stays is what no code can say: a doc comment on a declaration, a license
// header at the top of a file, and a comment with a link to the outside constraint it explains.
import ts from "typescript";

const isDoc = (text) => text.startsWith("/**");
const hasLink = (text) => /https?:\/\//.test(text);
const isLicense = (text, pos) => pos === 0 && /\b(license|copyright|spdx)\b/i.test(text);

/** The comments in `source` that aren't allowed, as `{ line, what }`, for `restrict`. */
export function comments(source) {
	const found = [];
	const seen = new Set();
	const look = (ranges) => {
		for (const { pos, end } of ranges ?? []) {
			if (seen.has(pos)) continue;
			seen.add(pos);
			const text = source.text.slice(pos, end);
			if (isDoc(text) || hasLink(text) || isLicense(text, pos)) continue;
			found.push({ line: source.getLineAndCharacterOfPosition(pos).line + 1, what: "has a comment" });
		}
	};
	const visit = (node) => {
		look(ts.getLeadingCommentRanges(source.text, node.getFullStart()));
		look(ts.getTrailingCommentRanges(source.text, node.getEnd()));
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}
