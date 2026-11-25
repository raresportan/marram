// How a feature map's lines read, shared by the static check (feature-map.mjs) and the runtime one (run.mjs), so both
// agree on what a feature and a citation are.

/** A feature's name from its `- **Name**` line, without trailing punctuation; undefined for any other line. */
export function featureOf(line) {
	const heading = /^\s*- \*\*(.+?)\*\*/.exec(line);
	return heading ? heading[1].replace(/[.:]+$/, "") : undefined;
}

/** A `- ✅ <citation>` or `- ❌ <why>` line's mark and text, trimmed; undefined for any other line. */
export function statusOf(line) {
	const status = /^\s*- (✅|❌) (.*?)\s*$/.exec(line);
	return status ? { mark: status[1], text: status[2] } : undefined;
}

/** A map's lines, whichever line endings it was saved with. */
export const mapLines = (markdown) => markdown.split(/\r?\n/);

/** Verification obligations in document order. A feature (its name without trailing punctuation) and its citation together identify the obligation. */
export function mapCitations(markdown) {
	const entries = [];
	let feature;
	for (const line of mapLines(markdown)) {
		feature = featureOf(line) ?? feature;
		const status = statusOf(line);
		if (feature && status?.mark === "✅" && status.text) entries.push({ feature, citation: status.text });
	}
	return entries;
}
