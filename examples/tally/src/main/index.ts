import { join } from "node:path";
import { background } from "@raresportan/marram/node/background";
import { app, BrowserWindow } from "electron";
import { serveCounter } from "../features/counter/host/index.ts";

function open(): Promise<void> {
	const window = new BrowserWindow({ width: 360, height: 240, webPreferences: { preload: join(import.meta.dirname, "..", "preload", "index.cjs") } });
	return window.loadFile(join(import.meta.dirname, "..", "renderer", "index.html"));
}

app.on("window-all-closed", () => app.quit());
background("start", app.whenReady().then(() => {
	serveCounter(join(app.getPath("userData"), "count.json"));
	return open();
}));
