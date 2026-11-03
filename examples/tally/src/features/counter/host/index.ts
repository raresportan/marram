import { ipcMain } from "electron";
import { CHANNELS } from "../shared/api.ts";
import { CounterStore } from "./store.ts";

/** Answers the renderer's counter requests from the count in `file`. */
export function serveCounter(file: string): void {
	const store = new CounterStore(file);
	ipcMain.handle(CHANNELS.read, () => store.read());
	ipcMain.handle(CHANNELS.increment, () => store.increment());
}
