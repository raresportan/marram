// Tally's journeys: the built app on Marram's session.
import { createRequire } from "node:module";
import { join } from "node:path";
import { type JourneyOptions, JourneySession } from "@raresportan/marram/electron/session";

const require = createRequire(import.meta.url);
export const TALLY = join(import.meta.dirname, "..", "..");

export class Session extends JourneySession {
	constructor(name: string, options: JourneyOptions) {
		super(name, options, "tally-verify");
	}

	/** Start the app (again, with the same profile and count after `close`), and wait for its window to load. */
	async launch(): Promise<void> {
		await this.start({ executablePath: require("electron") as unknown as string, main: join(TALLY, "out", "main", "index.js") });
		await this.page.waitForSelector("main");
	}
}
