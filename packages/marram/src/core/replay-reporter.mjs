export default async function* observations(events) {
	for await (const { type, data } of events) {
		if (type !== "test:pass" && type !== "test:fail") continue;
		const error = data.details.error;
		yield JSON.stringify({
			name: data.name, passed: type === "test:pass", skipped: Boolean(data.skip || data.todo),
			code: error?.cause?.code, message: error?.message,
		}) + "\n";
	}
}
