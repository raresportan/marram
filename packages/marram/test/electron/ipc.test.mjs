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

test("a contract registers nothing when a handler is missing, and calls handlers on their object", async () => {
	const contract = defineIpc("store", { read: operation(), write: operation() });
	const registered = new Map();
	const register = (channel, handler) => registered.set(channel, handler);
	assert.throws(() => contract.handle(register, { read: () => 1 }), /store has no handler for write/);
	assert.equal(registered.size, 0);
	class Store {
		value = 4;
		read() { return this.value; }
		write(value) { this.value = value; }
	}
	contract.handle(register, new Store());
	await registered.get("store:write")({}, 7);
	assert.equal(await registered.get("store:read")({}), 7);
});
