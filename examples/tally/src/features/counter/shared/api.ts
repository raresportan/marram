export const CHANNELS = { read: "counter:read", increment: "counter:increment" } as const;

/** What the renderer may ask of the counter. */
export interface CounterApi {
	read(): Promise<number>;
	increment(): Promise<number>;
}

declare global {
	interface Window {
		readonly counter: CounterApi;
	}
}
