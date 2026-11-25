/** A signature describes arguments and the resolved reply of one IPC operation. */
type Signature = (...args: never[]) => unknown;
type Operation<F extends Signature> = { readonly signature?: F };
export function operation<F extends Signature>(): Operation<F> {
	return {};
}

type Contract = Record<string, Operation<Signature>>;
type Method<C extends Contract, K extends keyof C> = NonNullable<C[K]["signature"]>;
export type IpcClient<C extends Contract> = {
	readonly [K in keyof C]: (...args: Parameters<Method<C, K>>) => Promise<Awaited<ReturnType<Method<C, K>>>>;
};
type Handlers<C extends Contract> = {
	readonly [K in keyof C]: (...args: Parameters<Method<C, K>>) => ReturnType<Method<C, K>> | Promise<ReturnType<Method<C, K>>>;
};

/** Generate the preload methods and the main-process registrations from the same channel names. */
export function defineIpc<C extends Contract>(namespace: string, operations: C) {
	const names = Object.keys(operations);
	return {
		client(invoke: (channel: string, ...args: unknown[]) => Promise<unknown>): IpcClient<C> {
			return Object.fromEntries(names.map((name) => [name, (...args: unknown[]) => invoke(namespace + ":" + name, ...args)])) as unknown as IpcClient<C>;
		},
		handle(register: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => void, handlers: Handlers<C>): void {
			for (const name of names) {
				const handle = handlers[name] as (...args: unknown[]) => unknown;
				register(namespace + ":" + name, (_event, ...args) => handle(...args));
			}
		},
	};
}
