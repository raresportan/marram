import { useCallback, useRef, useState } from "react";

/**
 * State that belongs to a key (a watch's parameters, a file, a document): under another key it reads as `initial`, so
 * nothing shows the last key's value while the new key's loads, not even for the one render an effect resetting it
 * would leave. Set it with the key the value is for, or with an update of that key's value; a late answer for a key
 * that's gone reads as `initial` too.
 */
export function useKeyed<T>(key: string, initial: T): [T, (forKey: string, value: T | ((previous: T) => T)) => void] {
	const [held, setHeld] = useState<{ key: string; value: T }>({ key, value: initial });
	const first = useRef(initial);
	const set = useCallback((forKey: string, value: T | ((previous: T) => T)) => {
		setHeld((last) => {
			const previous = last.key === forKey ? last.value : first.current;
			return { key: forKey, value: typeof value === "function" ? (value as (previous: T) => T)(previous) : value };
		});
	}, []);
	return [held.key === key ? held.value : initial, set];
}
