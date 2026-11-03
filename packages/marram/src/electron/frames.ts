// Frame rates: whatever the app shows or does, it keeps drawing at 60 frames per second or more. A scenario samples
// every frame the renderer draws (requestAnimationFrame) while it runs, plus the long animation frames Chromium
// reports, and checks the average rate and the longest frame. Displays faster than 60 Hz pass as long as no frame takes
// longer than two 60 Hz frames. A slow frame's details say where its time went: tasks, callbacks, or style and layout.
import type { JourneySession } from "./session.ts";

/** At least this many frames per second on average; a little under 60 for timer jitter. */
const MIN_FPS = 58;
/** No frame longer than this: one dropped frame at 60 Hz is a hitch nobody sees, two in a row are. */
const MAX_FRAME_MS = 35;
/** Sample at least this long, so a short action still says something about the rate. */
const MIN_SAMPLE_MS = 1000;

// Plain script text, so tsx's helpers don't leak into the page.
export const FRAME_SAMPLER = `globalThis.__fps = {
	start() {
		const state = { times: [], slow: [], running: true };
		const tick = (time) => {
			if (!state.running) return;
			state.times.push(time);
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		state.observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				const end = entry.startTime + entry.duration;
				state.slow.push({
					duration: Math.round(entry.duration),
					// Where the frame went: tasks before rendering, rAF and observer callbacks, then style and layout.
					tasks: Math.round((entry.renderStart || end) - entry.startTime),
					callbacks: Math.round(entry.renderStart ? entry.styleAndLayoutStart - entry.renderStart : 0),
					layout: Math.round(entry.styleAndLayoutStart ? end - entry.styleAndLayoutStart : 0),
					scripts: (entry.scripts ?? []).slice(0, 3).map((script) =>
						\`\${script.invoker || script.invokerType} \${Math.round(script.duration)}ms \${(script.sourceURL ?? "").split("/").pop()}\`),
				});
			}
		});
		try { state.observer.observe({ type: "long-animation-frame" }); } catch {}
		this.state = state;
	},
	stop() {
		const state = this.state;
		state.running = false;
		state.observer.disconnect();
		return { times: state.times, slow: state.slow };
	},
};`;

export interface Sample {
	readonly scenario: string;
	readonly fps: number;
	readonly longestMs: number;
	readonly p99Ms: number;
	readonly frames: number;
	readonly seconds: number;
	readonly slowFrames: { duration: number; tasks: number; callbacks: number; layout: number; scripts: string[] }[];
}

/** Run `action` while sampling frames (the page has run `FRAME_SAMPLER`), record the numbers in `samples`, and check them. */
export async function measureFrames(session: JourneySession, samples: Sample[], scenario: string, action: () => Promise<unknown>): Promise<void> {
	const { page } = session;
	await page.evaluate("globalThis.__fps.start()");
	const started = Date.now();
	await action();
	const left = MIN_SAMPLE_MS - (Date.now() - started);
	if (left > 0) await session.wait(left);
	const { times, slow } = (await page.evaluate("globalThis.__fps.stop()")) as { times: number[]; slow: Sample["slowFrames"] };
	const intervals = times.slice(1).map((time, index) => time - times[index]!);
	const sorted = [...intervals].sort((a, b) => a - b);
	const seconds = (times.at(-1)! - times[0]!) / 1000;
	const sample: Sample = {
		scenario,
		fps: Math.round((intervals.length / seconds) * 10) / 10,
		longestMs: Math.round(sorted.at(-1) ?? Infinity),
		p99Ms: Math.round(sorted[Math.floor(sorted.length * 0.99)] ?? Infinity),
		frames: intervals.length,
		seconds: Math.round(seconds * 10) / 10,
		slowFrames: slow,
	};
	samples.push(sample);
	const culprit = slow.toSorted((a, b) => b.duration - a.duration)[0];
	session.check(
		`${scenario}: at least 60 FPS`,
		sample.fps >= MIN_FPS && sample.longestMs <= MAX_FRAME_MS,
		`${sample.fps} fps, longest frame ${sample.longestMs}ms, p99 ${sample.p99Ms}ms over ${sample.seconds}s` +
			(culprit === undefined
				? ""
				: `; slowest: ${culprit.duration}ms (tasks ${culprit.tasks}ms, callbacks ${culprit.callbacks}ms, style and layout ${culprit.layout}ms)` +
					(culprit.scripts.length === 0 ? "" : ` in ${culprit.scripts.join(", ")}`)),
	);
}
