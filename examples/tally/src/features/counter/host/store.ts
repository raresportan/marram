import { readFile, rename, writeFile } from "node:fs/promises";

/** The count kept in `file`. A missing or damaged file counts as zero. */
export class CounterStore {
	readonly #file: string;
	#tail: Promise<unknown> = Promise.resolve();

	constructor(file: string) {
		this.#file = file;
	}

	async read(): Promise<number> {
		await this.#tail.catch(() => {});
		return this.#load();
	}

	/** Adds one, in the order asked, written whole so a crash leaves the last count. */
	increment(): Promise<number> {
		const next = this.#tail.catch(() => {}).then(async () => {
			const count = (await this.#load()) + 1;
			await writeFile(`${this.#file}.tmp`, JSON.stringify({ count }));
			await rename(`${this.#file}.tmp`, this.#file);
			return count;
		});
		this.#tail = next;
		return next;
	}

	async #load(): Promise<number> {
		try {
			const { count } = JSON.parse(await readFile(this.#file, "utf8")) as { count: unknown };
			return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : 0;
		} catch {
			return 0;
		}
	}
}
