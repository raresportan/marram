import { ipcMain } from "electron";
import { counterIpc } from "../shared/api.ts";
import { CounterStore } from "./store.ts";

/** Answers the renderer's counter requests from the count in `file`. */
export function serveCounter(file: string): void {
	const store = new CounterStore(file);
	counterIpc.handle((channel, handler) => ipcMain.handle(channel, handler), {
		read: () => store.read(),
		increment: () => store.increment(),
	});
}
