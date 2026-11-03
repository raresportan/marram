// What a user does with Tally, driven on the built app.
import { hiddenControls } from "@raresportan/marram/electron/geometry";
import { checkFeatureMap } from "@raresportan/marram/electron/feature-map";
import { join } from "node:path";
import { type Session, TALLY } from "./harness.ts";

export async function counts(session: Session): Promise<void> {
	await session.launch();
	const button = () => session.page.getByRole("button", { name: /Count/ });
	await session.check("It starts at zero", async () => (await button().textContent()) === "Count: 0");
	await button().click();
	await session.check("One click counts one", async () => (await button().textContent()) === "Count: 1");
	await session.shot("counted");
	await session.close();
	await session.launch();
	await session.check("The count survives a restart", async () => (await button().textContent()) === "Count: 1");
}

export async function layout(session: Session): Promise<void> {
	await session.launch();
	await session.check("Every control can be clicked where it's drawn", async () => (await hiddenControls(session.page, "main")).length === 0, async () => (await hiddenControls(session.page, "main")).join("; "));
}

export const JOURNEYS: Record<string, { readonly run: (session: Session) => Promise<void>; readonly app: boolean }> = {
	counts: { run: counts, app: true },
	layout: { run: layout, app: true },
	"feature-map": {
		app: false,
		run: async (session) => checkFeatureMap(session, { map: join(TALLY, "docs", "feature-map.md"), folder: join(TALLY, "scripts", "verify"), journeys: JOURNEYS }),
	},
};
