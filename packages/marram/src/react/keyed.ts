import { useCallback, useReducer } from "react";

type Value<T> = T | ((previous: T) => T);

/**
 * State that belongs to a key (a watch's parameters, a file, a document): under another key it reads as `initial`, so
 * nothing shows the last key's value while the new key's loads, not even for the one render an effect resetting it
 * would leave. Set it with the key the value is for, or with an update of that key's value; a late answer for a key
 * that's gone is dropped, so it can't take the place of the current key's value. A key says only what a value is for:
 * two requests under one key can still answer out of order, so a caller that re-reads puts a version or try in the key.
 */
export function useKeyed<T>(key: string, initial: T): [T, (forKey: string, value: Value<T>) => void] {
	// Written inline because React runs a reducer in the render an update lands in: this one sees that render's key, which
	// `set`, called from a promise or a listener, can't know.
	const [held, apply] = useReducer(
		(last: { key: string; value: T }, { forKey, value }: { forKey: string; value: Value<T> }) => {
			if (forKey !== key) return last;
			const previous = last.key === key ? last.value : initial;
			return { key, value: typeof value === "function" ? (value as (previous: T) => T)(previous) : value };
		},
		{ key, value: initial },
	);
	const set = useCallback((forKey: string, value: Value<T>) => apply({ forKey, value }), []);
	return [held.key === key ? held.value : initial, set];
}
