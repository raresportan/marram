import { background } from "@raresportan/marram/node/background";
import { useEffect, useState } from "react";

export function Counter() {
	const [count, setCount] = useState<number | undefined>(undefined);
	useEffect(() => {
		background("read the count", window.counter.read().then(setCount));
	}, []);
	return (
		<main>
			<button type="button" disabled={count === undefined} onClick={() => background("count", window.counter.increment().then(setCount))}>
				Count: {count ?? "…"}
			</button>
		</main>
	);
}
