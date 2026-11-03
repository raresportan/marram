import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type CounterApi } from "../features/counter/shared/index.ts";

const counter: CounterApi = {
	read: () => ipcRenderer.invoke(CHANNELS.read) as Promise<number>,
	increment: () => ipcRenderer.invoke(CHANNELS.increment) as Promise<number>,
};
contextBridge.exposeInMainWorld("counter", counter);
