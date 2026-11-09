// State held for a key, in real React: the component draws nothing, so a stand-in for the DOM's container is enough.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { useKeyed } from "../../src/react/keyed.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { HTMLIFrameElement: class {} };

const ignore = () => {};
const container = () => ({ nodeType: 1, tagName: "DIV", addEventListener: ignore, ownerDocument: { addEventListener: ignore } });

/** Mounts a component holding a value under `key`: what it shows, and ways to move to another key and to set a value. */
async function mounted(key) {
	const view = {};
	function View() {
		const [current, setCurrent] = useState(key);
		const [value, set] = useKeyed(current, "initial");
		Object.assign(view, { value, set, moveTo: setCurrent });
		return null;
	}
	await act(async () => createRoot(container()).render(createElement(View)));
	return view;
}

test("a key's value shows under that key, and another key reads as initial", async () => {
	const view = await mounted("a");
	await act(async () => view.set("a", "for a"));
	assert.equal(view.value, "for a");
	await act(async () => view.moveTo("b"));
	assert.equal(view.value, "initial");
});

test("a late answer for a key that's gone leaves the current key's value", async () => {
	const view = await mounted("a");
	await act(async () => view.moveTo("b"));
	await act(async () => view.set("b", "for b"));
	await act(async () => view.set("a", "late, for a"));
	assert.equal(view.value, "for b");
});

test("a late answer doesn't count for its key when that key comes back", async () => {
	const view = await mounted("a");
	await act(async () => view.moveTo("b"));
	await act(async () => view.set("a", "late, for a"));
	await act(async () => view.moveTo("a"));
	assert.equal(view.value, "initial");
});

test("a value set as the key moves to it counts", async () => {
	const view = await mounted("a");
	await act(async () => {
		view.moveTo("b");
		view.set("b", "for b");
	});
	assert.equal(view.value, "for b");
});

test("an update starts from the key's value, or initial when it has none", async () => {
	const view = await mounted("a");
	await act(async () => view.set("a", (previous) => `${previous}, then a`));
	assert.equal(view.value, "initial, then a");
	await act(async () => view.set("a", (previous) => `${previous} again`));
	assert.equal(view.value, "initial, then a again");
	await act(async () => view.moveTo("b"));
	await act(async () => view.set("b", (previous) => `${previous}, then b`));
	assert.equal(view.value, "initial, then b");
});
