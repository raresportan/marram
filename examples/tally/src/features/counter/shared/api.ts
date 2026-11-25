import { defineIpc, operation } from "@raresportan/marram/electron/ipc";

export const counterIpc = defineIpc("counter", {
	read: operation<() => number>(),
	increment: operation<() => number>(),
});

export type CounterApi = ReturnType<typeof counterIpc.client>;

declare global {
	interface Window {
		readonly counter: CounterApi;
	}
}
