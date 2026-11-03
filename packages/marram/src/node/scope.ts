// Resources that outlive their owner (a watch after its client left, a process after its session) came from code that
// acquired one in passing and freed it, or didn't, by hand. A scope is the owner's list of what holds resources for it:
// each holder joins once, where it is made, so ending the owner has no list of its own to keep up to date. A new kind
// of resource ends with the owner because its holder joined.

/** Something that holds resources for owners (a session's processes, a client's watches), keyed by the owner's `K`. */
export interface Holder<K, C = void> {
	/** What it holds, for errors and checks ("processes", "browser page"). */
	readonly name: string;
	/**
	 * `work` for what runs for the owner and may start more (its jobs, its commands): ended first, so nothing it was
	 * about to start reaches the other holders after they were ended.
	 */
	readonly stage?: "work";
	/** Free everything held for `owner`. Ending waits for it, so it stops work rather than waiting for it to end. */
	end(owner: K, context: C): Promise<void> | void;
	/** Whether anything is still held for `owner`; checks use it to see that ending one left nothing behind. */
	holds(owner: K): Promise<boolean> | boolean;
}

/** Everything that holds resources for owners of one kind (`what`: "session", "client"), ended together per owner. */
export class Scope<K, C = void> {
	readonly #holders = new Set<Holder<K, C>>();
	/** What kind of owner it is ("session"), for errors. */
	readonly what: string;

	constructor(what: string) {
		this.what = what;
	}

	/** Join; the returned function leaves again (when the holder itself closes). */
	hold(holder: Holder<K, C>): () => void {
		this.#holders.add(holder);
		return () => this.#holders.delete(holder);
	}

	/** The holders' names, in the order they joined. */
	get names(): string[] {
		return [...this.#holders].map((holder) => holder.name);
	}

	/**
	 * End everything held for `owner`: its work first, then the rest, each stage's holders at once. One failing doesn't
	 * spare the others, but fails the end.
	 */
	async end(owner: K, context: C): Promise<void> {
		const failed: { name: string; reason: unknown }[] = [];
		for (const stage of [[...this.#holders].filter((holder) => holder.stage === "work"), [...this.#holders].filter((holder) => holder.stage !== "work")]) {
			const results = await Promise.allSettled(stage.map(async (holder) => holder.end(owner, context)));
			failed.push(...results.flatMap((result, i) => (result.status === "rejected" ? [{ name: stage[i]!.name, reason: result.reason as unknown }] : [])));
		}
		if (failed.length > 0) {
			throw new Error(`Couldn't end the ${this.what}'s ${failed.map(({ name }) => name).join(", ")}: ${failed.map(({ reason }) => (reason instanceof Error ? reason.message : String(reason))).join("; ")}`, { cause: failed[0]!.reason });
		}
	}

	/** The names of the holders that still hold something for `owner`. */
	async holding(owner: K): Promise<string[]> {
		const holders = [...this.#holders];
		const holds = await Promise.all(holders.map((holder) => holder.holds(owner)));
		return holders.filter((_, i) => holds[i]).map((holder) => holder.name);
	}
}
