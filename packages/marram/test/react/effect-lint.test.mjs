// The effect lint's finder: an effect that sets its component's state in its own body. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";
import { effectSets } from "../../src/react/effect-lint.mjs";

const sets = (code) => effectSets(ts.createSourceFile("x.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)).map(({ line, effect, setter }) => `${line} ${effect} ${setter}`);

test("an effect that copies state into state in its own body is found", () => {
	assert.deepEqual(sets(`const [a, setA] = useState(0);\nuseEffect(() => { setA(b); }, [b]);`), ["2 useEffect setA"]);
	assert.deepEqual(sets(`const [a, setA] = React.useState(0);\nuseLayoutEffect(function () { if (x) setA(1); });`), ["2 useLayoutEffect setA"]);
});

test("a setter called in what the effect hands on, or another component's setter, isn't", () => {
	assert.deepEqual(sets(`const [a, setA] = useState(0);\nuseEffect(() => { const off = listen(() => setA(1)); return off; });`), []);
	assert.deepEqual(sets(`const [a, setA] = useState(0);\nuseEffect(() => { load().then((v) => setA(v)); });`), []);
	assert.deepEqual(sets(`useEffect(() => { setOther(1); });`), []);
	assert.deepEqual(sets(`const [a, setA] = useState(0);\nuseMemo(() => setA(1));`), []);
});
