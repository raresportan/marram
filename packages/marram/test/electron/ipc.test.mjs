// The typed IPC contract at runtime: the client and the host agree on channel names and pass arguments through.
// Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { test } from "node:test";
import { defineIpc, operation } from "../../src/electron/ipc.ts";

test("a contract's client reaches the handler registered for the same operation", async () => {
	const contract = defineIpc("counter", { read: operation(), add: operation() });
	const registered = new Map();
	let count = 1;
	contract.handle((channel, handler) => registered.set(channel, handler), {
		read: () => count,
		add: async (by) => (count += by),
	});
	assert.deepEqual([...registered.keys()], ["counter:read", "counter:add"]);
	const sent = [];
	const client = contract.client((channel, ...args) => {
		sent.push([channel, ...args]);
		return Promise.resolve(registered.get(channel)({ sender: "renderer" }, ...args));
	});
	assert.equal(await client.read(), 1);
	assert.equal(await client.add(2), 3);
	assert.deepEqual(sent, [["counter:read"], ["counter:add", 2]]);
});
