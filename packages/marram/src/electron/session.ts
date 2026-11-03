// A journey drives the built Electron app as a user would and records named checks, with screenshots as evidence. The
// session launches the app with a profile of its own, keeps out of the user's way while it runs, and holds the checks:
// a check given a function polls it, so it never races what the app is still doing, and one nobody awaited is still
// unsettled when the journey ends, which fails it (see run.ts). A project extends it with its own setup (a backend
// to start, a client to connect).
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";

export interface Check {
	readonly label: string;
	readonly ok: boolean;
	readonly detail?: string;
}

export interface JourneyOptions {
	/** Where screenshots and the report go. */
	readonly evidence: string;
	/** Leave the scratch folder (profile and data) in place for inspection. */
	readonly keep: boolean;
	/**
	 * Capture the real window (with macOS vibrancy) instead of the page; needs Screen Recording permission. The window
	 * stays in the background, so it shows its inactive look (grey traffic lights).
	 */
	readonly osCapture: boolean;
}

export interface Launch {
	/** The Electron (or packaged app) executable. */
	readonly executablePath: string;
	/** The app's main script, imported by the bootstrap once the profile is set. */
	readonly main: string;
	/** Extra environment for the main process. */
	readonly env?: Record<string, string>;
	/** Where the bootstrap goes, which Electron takes as the app's path. */
	readonly appDir?: string;
	/** Keep Chromium drawing every frame while the window is in the background or covered, to measure frame rates. */
	readonly unthrottled?: boolean;
	/** Lines the bootstrap runs before the app's main: stand-ins and recorders for what a journey checks. */
	readonly prelude?: readonly string[];
}

/** How long a check given as a function polls before it fails. */
const CHECK_MS = 10_000;

export class JourneySession {
	app!: ElectronApplication;
	page!: Page;
	readonly checks: Check[] = [];
	/** Polled checks still going: one left when the journey ends was never awaited, and would go unrecorded. */
	readonly unsettled = new Set<string>();
	readonly pageErrors: string[] = [];
	readonly name: string;
	readonly options: JourneyOptions;
	/** The journey's own folder, removed at the end unless `keep`. */
	readonly scratch: string;
	readonly userData: string;
	#windowId: string | undefined;
	#osCapture: boolean;

	constructor(name: string, options: JourneyOptions, prefix = "marram-verify") {
		this.name = name;
		this.options = options;
		this.scratch = mkdtempSync(join(tmpdir(), `${prefix}-${name}-`));
		this.userData = join(this.scratch, "profile");
		mkdirSync(this.options.evidence, { recursive: true });
		this.#osCapture = options.osCapture && process.platform === "darwin";
	}

	/** Start the app (again, with the same profile after `close`), and wait for its first window. */
	protected async start({ executablePath, main, env = {}, appDir = this.scratch, unthrottled = false, prelude = [] }: Launch): Promise<void> {
		const bootstrap = join(appDir, "bootstrap.mjs");
		writeFileSync(
			bootstrap,
			[
				`import { app, BrowserWindow } from "electron";`,
				// A profile of its own, set before the app's main runs, so each journey starts clean.
				`app.setPath("userData", ${JSON.stringify(this.userData)});`,
				// Stay out of the user's way: no Dock icon, and windows open without taking focus or the front.
				`if (process.platform === "darwin") app.setActivationPolicy("accessory");`,
				`BrowserWindow.prototype.show = BrowserWindow.prototype.showInactive;`,
				...(unthrottled
					? [
							`for (const name of ["disable-renderer-backgrounding", "disable-backgrounding-occluded-windows", "disable-background-timer-throttling"]) app.commandLine.appendSwitch(name);`,
							`app.on("browser-window-created", (_event, window) => window.webContents.setBackgroundThrottling(false));`,
						]
					: []),
				...prelude,
				`await import(${JSON.stringify(main)});`,
			].join("\n"),
		);
		this.app = await electron.launch({ executablePath, args: [bootstrap], env: { ...process.env, ...env } as Record<string, string> });
		// Electron's own output, for crashes and warnings the page doesn't see.
		const log = join(this.options.evidence, "electron.log");
		this.app.process().stdout?.on("data", (chunk: Buffer) => appendFileSync(log, chunk));
		this.app.process().stderr?.on("data", (chunk: Buffer) => appendFileSync(log, chunk));
		this.page = await this.app.firstWindow();
		// Without a default, an action on a locator that never matches waits forever.
		this.page.setDefaultTimeout(15_000);
		this.page.on("pageerror", (error) => this.pageErrors.push(error.message));
		this.page.on("console", (message) => {
			if (message.type() === "error") this.pageErrors.push(message.text());
		});
		this.#windowId = undefined;
		if (this.#osCapture) {
			// Captured by window id, which works while other windows cover it.
			this.#windowId = (await this.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMediaSourceId())).split(":")[1];
		}
	}

	/**
	 * Records a check. Given a value, it records what the journey already knows. Given a function that reads the page
	 * or the app, it polls it until it holds, for up to `CHECK_MS` (a throw counts as not yet): read once, a check
	 * races whatever the app is still doing. A `detail` function is read on failure, so it says what was seen at the
	 * end. Await the function form: `@raresportan/marram/electron/journey-lint` fails on one that isn't.
	 */
	check(label: string, ok: boolean, detail?: string): void;
	check(label: string, ok: () => boolean | Promise<boolean>, detail?: string | (() => string | undefined | Promise<string | undefined>)): Promise<void>;
	check(label: string, ok: boolean | (() => boolean | Promise<boolean>), detail?: string | (() => string | undefined | Promise<string | undefined>)): void | Promise<void> {
		if (typeof ok === "boolean") return this.#record(label, ok, detail as string | undefined);
		this.unsettled.add(label);
		return (async () => {
			let error: unknown;
			const held = await this.until(async () => {
				try {
					const value = await ok();
					error = undefined;
					return value;
				} catch (thrown) {
					error = thrown;
					return false;
				}
			}, label, CHECK_MS).then(() => true, () => false);
			if (held) return this.#record(label, true);
			const seen = typeof detail === "function" ? await Promise.resolve().then(detail).catch((thrown: unknown) => `(reading it threw: ${String(thrown)})`) : detail;
			this.#record(label, false, [seen, error === undefined ? undefined : `last threw: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`].filter((part) => part !== undefined && part !== "").join("; "));
		})().finally(() => this.unsettled.delete(label));
	}

	#record(label: string, ok: boolean, detail?: string): void {
		this.checks.push({ label, ok, ...(detail === undefined || detail === "" ? {} : { detail }) });
		console.log(`  ${ok ? "✓" : "✗"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
	}

	/** A screenshot named `name` in the evidence folder: of the window when capturing it, else of the page. */
	async shot(name: string): Promise<void> {
		await this.wait(400);
		const file = join(this.options.evidence, `${name}.png`);
		if (this.#windowId !== undefined) {
			try {
				execFileSync("screencapture", ["-x", "-o", `-l${this.#windowId}`, file]);
				return;
			} catch {
				// No Screen Recording permission: fall back to the page, without the window's vibrancy.
				this.#osCapture = false;
				this.#windowId = undefined;
			}
		}
		await this.page.screenshot({ path: file });
	}

	wait(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	async until(test: () => boolean | Promise<boolean>, what: string, timeout = 10_000): Promise<void> {
		const deadline = Date.now() + timeout;
		while (!(await test())) {
			if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
			await this.wait(100);
		}
	}

	/** Close the app, keeping its profile and data for a relaunch. */
	async close(): Promise<void> {
		await this.app?.close().catch(() => {});
	}

	/** Close the app and remove the scratch folder (unless `keep`). A project that starts more ends it first. */
	async dispose(): Promise<void> {
		await this.close();
		if (this.options.keep) console.log(`  kept ${this.scratch}`);
		else rmSync(this.scratch, { recursive: true, force: true });
	}
}
