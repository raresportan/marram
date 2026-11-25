import { defineIpc, operation } from "../../src/electron/ipc.ts";

const contract = defineIpc("example", { read: operation<() => number>(), write: operation<(value: number) => void>() });
const register = () => {};
contract.handle(register, { read: () => 1, write: (value) => void value });
// @ts-expect-error every declared operation needs a host handler
contract.handle(register, { read: () => 1 });
// @ts-expect-error replies must match the operation
contract.handle(register, { read: () => "one", write: () => {} });
const client = contract.client(async () => undefined);
const reply: Promise<number> = client.read();
void reply;
// @ts-expect-error the client must send a number
void client.write("one");
