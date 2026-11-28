// The effect lint's finder: an effect that sets its component's state in its own body. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "../../src/core/typescript.mjs";
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

test("an effect called on React's namespace, or with an arrow's expression for a body, is found", () => {
	assert.deepEqual(sets(`const [a, setA] = React.useState(0);\nReact.useEffect(() => { setA(b); }, [b]);`), ["2 useEffect setA"]);
	assert.deepEqual(sets(`function C() {\n\tconst [a, setA] = useState(0);\n\tReact.useLayoutEffect(() => setA(1));\n}`), ["3 useLayoutEffect setA"]);
});

test("a setter is its own component's: another component's effect calling the same name isn't found", () => {
	const code = `function A() {\n\tconst [v, setValue] = useState(0);\n\treturn v;\n}\nfunction B({ setValue }) {\n\tuseEffect(() => { setValue(1); }, []);\n}\nconst C = () => {\n\tconst [w, setValue] = useState(0);\n\tuseEffect(() => { setValue(2); });\n};`;
	assert.deepEqual(sets(code), ["10 useEffect setValue"]);
});

test("a useEffect or useState method on another object isn't React's", () => {
	assert.deepEqual(sets(`const [a, setA] = useState(0);\nstore.useEffect(() => { setA(1); });\nthis.useLayoutEffect(() => setA(2));`), []);
	assert.deepEqual(sets(`const [a, setA] = store.useState(0);\nuseEffect(() => { setA(1); });`), []);
	assert.deepEqual(sets(`import * as R from "react";\nconst [a, setA] = R.useState(0);\nR.useEffect(() => { setA(1); });`), ["3 useEffect setA"]);
	assert.deepEqual(sets(`import Re, { useState } from "react";\nconst [a, setA] = useState(0);\nRe.useEffect(() => { setA(1); });`), ["3 useEffect setA"]);
});
