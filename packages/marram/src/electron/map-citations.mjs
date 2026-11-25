/** Verification obligations in document order. A feature (its name without trailing punctuation) and its citation together identify the obligation. */
export function mapCitations(markdown) {
	const entries = [];
	let feature;
	for (const line of markdown.split(/\r?\n/)) {
		const heading = /^\s*- \*\*(.+?)\*\*/.exec(line);
		if (heading) feature = heading[1].replace(/[.:]+$/, "");
		const status = /^\s*- ✅ (.+?)\s*$/.exec(line);
		if (feature && status) entries.push({ feature, citation: status[1] });
	}
	return entries;
}
