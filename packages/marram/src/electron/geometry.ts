// Layout held as relationships between boxes rather than pixels: this edge meets that one, this box doesn't overlap
// that one, every control shown can be clicked where it's drawn. Screenshots change with live times, fonts and motion;
// these hold whatever the content.
import type { Locator, Page } from "playwright-core";

export interface Box {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/** Half a pixel, for subpixel layout. */
const SLACK = 0.5;

/** `locator`'s box in the window, or a failure naming `what` when it isn't shown. */
export async function box(locator: Locator, what: string): Promise<Box> {
	const found = await locator.boundingBox();
	if (found === null) throw new Error(`${what} isn't shown`);
	return { left: found.x, top: found.y, right: found.x + found.width, bottom: found.y + found.height };
}

export const inside = (inner: Box, outer: Box): boolean =>
	inner.left >= outer.left - SLACK && inner.right <= outer.right + SLACK && inner.top >= outer.top - SLACK && inner.bottom <= outer.bottom + SLACK;

/** `upper` ends at least `gap` above where `lower` starts. */
export const above = (upper: Box, lower: Box, gap = 0): boolean => upper.bottom + gap <= lower.top + SLACK;

export const apart = (a: Box, b: Box): boolean => a.right <= b.left + SLACK || b.right <= a.left + SLACK || above(a, b) || above(b, a);

export const near = (a: number, b: number, within = 1): boolean => Math.abs(a - b) <= within;

/** The boxes, rounded, for a failure's details. */
export const shown = (boxes: Record<string, Box>): string =>
	JSON.stringify(Object.fromEntries(Object.entries(boxes).map(([name, { left, top, right, bottom }]) => [name, [left, top, right, bottom].map(Math.round)])));

/**
 * The controls under `root` that are shown but can't be clicked where they're drawn: cut off by a box that clips them
 * (or by the window), covered by something else at their centre, or letting clicks through to what's beneath. A
 * control scrolled out of view, or partly out of a box that scrolls that way, is fine; one cut off across the way its
 * box scrolls (a row wider than a sidebar that only scrolls up and down) is not. Invisible ones (hover actions at
 * opacity 0) aren't shown.
 */
export async function hiddenControls(page: Page, root: string): Promise<string[]> {
	// tsx names the functions inside, with a helper the page doesn't have.
	await page.evaluate("globalThis.__name ??= (target) => target;");
	return page.evaluate((root) => {
		const name = (element: Element) => {
			const label = element.getAttribute("aria-label") ?? element.getAttribute("title") ?? element.textContent?.trim().slice(0, 40);
			return `${element.tagName.toLowerCase()} "${label ?? ""}"`;
		};
		const where = (element: Element) => `${element.tagName.toLowerCase()}.${[...element.classList].slice(0, 4).join(".")}`;
		/** Drawn at all: some size, and neither hidden nor faded out (with its ancestors). */
		const drawn = (control: Element, rect: DOMRect) => {
			if (rect.width === 0 || rect.height === 0) return false;
			let opacity = 1;
			for (let node: Element | null = control; node !== null; node = node.parentElement) {
				const style = getComputedStyle(node);
				if (style.visibility === "hidden" || style.display === "none") return false;
				opacity *= Number(style.opacity);
			}
			return opacity >= 0.05;
		};
		/** The boxes that clip `control`, innermost first, each with whether it scrolls up and down; then the window. */
		const clips = (control: Element) => {
			const found: Array<{ clip: DOMRect; label: string; scrolls: boolean }> = [];
			for (let node = control.parentElement; node !== null && node !== document.documentElement; node = node.parentElement) {
				const style = getComputedStyle(node);
				if (style.overflowX === "visible" && style.overflowY === "visible") continue;
				found.push({ clip: node.getBoundingClientRect(), label: where(node), scrolls: style.overflowY === "auto" || style.overflowY === "scroll" });
			}
			found.push({ clip: new DOMRect(0, 0, window.innerWidth, window.innerHeight), label: "the window", scrolls: false });
			return found;
		};
		/** "away" when `rect` is scrolled (wholly or partly) out of a box that scrolls, else the box cutting it off, if any. */
		const cutOff = (rect: DOMRect, control: Element) => {
			for (const { clip, label, scrolls } of clips(control)) {
				if (rect.right <= clip.left || rect.left >= clip.right || rect.bottom <= clip.top || rect.top >= clip.bottom) return "away";
				const across = rect.left < clip.left - 0.5 || rect.right > clip.right + 0.5;
				const along = rect.top < clip.top - 0.5 || rect.bottom > clip.bottom + 0.5;
				if (across || (along && !scrolls)) return label;
				if (along) return "away";
			}
			return undefined;
		};
		const problem = (control: Element) => {
			const rect = control.getBoundingClientRect();
			if (!drawn(control, rect)) return [];
			const cut = cutOff(rect, control);
			if (cut === "away") return [];
			if (cut !== undefined) return [`${name(control)} is cut off by ${cut}`];
			const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
			if (hit === null || control.contains(hit)) return [];
			// Under its own box, a click only reaches an ancestor when the control lets it through (pointer-events: none).
			return [hit.contains(control) ? `${name(control)} lets clicks through to ${where(hit)}` : `${name(control)} is covered by ${where(hit)}`];
		};
		const scope = document.querySelector(root);
		if (scope === null) return [`${root} isn't shown`];
		return [...scope.querySelectorAll('button, a[href], input:not([type="hidden"]), textarea, select, [role="tab"], [role="menuitem"]')].flatMap(problem);
	}, root);
}
