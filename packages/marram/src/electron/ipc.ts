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

/** A contract keyed by a symbol anywhere: such an operation has no channel name, so it's refused. */
type StringKeyed<C> = { readonly [K in keyof C]: K extends symbol ? never : C[K] };

/**
 * Generate the preload methods and the main-process registrations from the same channel names. An operation is named
 * by a string: one keyed by a symbol has no channel, so its client method would be missing at runtime.
 */
export function defineIpc<C extends Contract>(namespace: string, operations: C & StringKeyed<C>) {
	const [symbol] = Object.getOwnPropertySymbols(operations);
	if (symbol !== undefined) throw new Error(`${namespace}: an operation's name must be a string, not ${String(symbol)}`);
	const names = Object.keys(operations);
	return {
		client(invoke: (channel: string, ...args: unknown[]) => Promise<unknown>): IpcClient<C> {
			return Object.fromEntries(names.map((name) => [name, (...args: unknown[]) => invoke(namespace + ":" + name, ...args)])) as unknown as IpcClient<C>;
		},
		handle(register: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => void, handlers: Handlers<C>): void {
			const methods = handlers as unknown as Record<string, (...args: unknown[]) => unknown>;
			const missing = names.filter((name) => typeof methods[name] !== "function");
			if (missing.length > 0) throw new Error(`${namespace} has no handler for ${missing.join(", ")}`);
			// Called on `handlers`, so an object's methods (a store's read and increment) keep their `this`.
			for (const name of names) register(namespace + ":" + name, (_event, ...args) => methods[name]!(...args));
		},
	};
}
