import { contextBridge, ipcRenderer } from "electron";
import { counterIpc } from "../features/counter/shared/index.ts";

contextBridge.exposeInMainWorld("counter", counterIpc.client((channel, ...args) => ipcRenderer.invoke(channel, ...args)));
