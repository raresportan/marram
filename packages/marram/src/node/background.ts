// Work a process starts and doesn't wait for: a refresh, a publish, a log line. Node ends the process on a rejection
// nobody handles, so such work is handed here rather than dropped with `void`, which silences the linter, not the
// rejection. `@raresportan/marram/node/promise-lint` holds code to it.

/** Run `work` (if any) without waiting for it; a failure is logged under `label` instead of ending the process. */
export function background(label: string, work: Promise<unknown> | undefined): void {
	work?.catch((error: unknown) => console.warn(`[${label}]`, error));
}

/**
 * The backstop for a rejection that still goes unheard (a promise kept in a variable and dropped, which the lint can't
 * see): it's logged, and the process keeps serving. A synchronous uncaught exception still ends it, as its state may be
 * broken; a rejected background refresh isn't worth what's running.
 */
export function hearRejections(): void {
	process.on("unhandledRejection", (reason) => console.error("[unhandled rejection]", reason));
}
