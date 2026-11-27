// Reading a test file's tests from its source: names, skips and how many assertions each makes. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { test } from "node:test";
import { isTestFile, testsIn } from "../../src/core/test-inventory.mjs";

const summary = (path, source) => testsIn(path, source).map(({ name, skipped, only, assertions }) => `${name}${skipped ? " (skipped)" : ""}${only ? " (only)" : ""}: ${assertions}`);

test("test files are recognized by the usual names, and only in languages that can be read", () => {
	for (const path of ["a.test.mjs", "src/b.spec.ts", "test/c.mjs", "pkg/tests/d.cjs", "__tests__/e.jsx", "test_f.py", "g_test.py", "tests/h.py", "i_test.go"]) assert.equal(isTestFile(path), true, path);
	for (const path of ["src/a.mjs", "testing.mjs", "contest.test.md", "test/data.json", "latest/a.py", "main.go"]) assert.equal(isTestFile(path), false, path);
});

test("JavaScript tests are named within their suites, with skips and assertions", () => {
	const source = `
import { describe, it, test } from "node:test";
// test("in a comment", () => assert.ok(false));
const pattern = /it\\("in a regex"/;
describe("counter", () => {
	it("reads one", () => {
		assert.equal(read(), 1, "it starts at one");
		assert.match(label(), /one/);
	});
	it.skip("reads two", () => assert.equal(read(), 2));
	it("reads three", { skip: "flaky" }, () => expect(read()).toBe(3));
	xit("reads four", () => {});
	describe.todo("later", () => it("inner", () => assert.ok(true)));
});
test('saves "quoted" names', async (t) => {
	t.assert.strictEqual(save(), true);
	const text = "assert.ok(not counted)";
});
test(\`a template name\`, () => {});
test("reads three", { skip: false }, () => assert.ok(1));
`;
	assert.deepEqual(summary("a.test.mjs", source), [
		"counter › reads one: 2",
		"counter › reads two (skipped): 1",
		"counter › reads three (skipped): 1",
		"counter › reads four (skipped): 0",
		"counter › later › inner (skipped): 1",
		'saves "quoted" names: 1',
		"a template name: 0",
		"reads three: 1",
	]);
});

test("a name repeated in the same suite is told apart by its occurrence", () => {
	const source = 'test("same", () => assert.ok(1));\ntest("same", () => {});\n';
	assert.deepEqual(testsIn("a.test.mjs", source).map(({ key }) => key), ['["same",1]', '["same",2]']);
});

test("Python tests are named within their classes, with skip decorators and assertions", () => {
	const source = `
import pytest

def helper():
    assert False

def test_reads_one():
    # assert in a comment
    assert read() == 1
    assert label() == "one"

@pytest.mark.skip(reason="flaky")
def test_reads_two():
    assert read() == 2

class TestCounter:
    def test_saves(self):
        self.assertEqual(save(), True)
        with pytest.raises(ValueError):
            save(None)

@pytest.mark.skipif(True, reason="never")
class TestLater:
    def test_inner(self):
        assert True
`;
	assert.deepEqual(summary("test_counter.py", source), [
		"test_reads_one: 2",
		"test_reads_two (skipped): 1",
		"TestCounter › test_saves: 2",
		"TestLater › test_inner (skipped): 1",
	]);
});

test("Go tests are read with a t.Skip in their body and their failure calls", () => {
	const source = `
package counter

import "testing"

func TestReadsOne(t *testing.T) {
	if got := read(); got != 1 {
		t.Errorf("read() = %d, want 1 // not a comment", got)
	}
	require.Equal(t, 1, read())
}

func TestReadsTwo(t *testing.T) {
	t.Skip("flaky")
	if read() != 2 {
		t.Fatal("not two")
	}
}

func helper(t *testing.T) { t.Fatal("not a test") }
`;
	assert.deepEqual(summary("counter_test.go", source), ["TestReadsOne: 2", "TestReadsTwo (skipped): 1"]);
});

test("a file in a language it can't read has no tests it can name", () => {
	assert.equal(testsIn("spec/a.rb", "it 'works' do end"), undefined);
});

test("a .test() call on a pattern isn't a test, and a subtest on the test's own context is", () => {
	const source = `
test("matches", async (t) => {
	assert.ok(/re/.test("bar"));
	assert.ok(pattern.test("abc"));
	await t.test("a subtest", () => assert.ok(true));
});
it("checks", function (context) {
	helper.test("not on this test's context", () => {});
	other.it("nor this", () => {});
});
`;
	assert.deepEqual(summary("a.test.mjs", source), ["matches: 3", "matches › a subtest: 1", "checks: 0"]);
});

test("a test or suite run alone (.only, an f prefix, { only: true }) is marked, and its tests with it", () => {
	const source = `
it.only("alone", () => assert.ok(1));
fit("also alone", () => assert.ok(1));
describe.only("suite", () => it("inside", () => assert.ok(1)));
fdescribe("other suite", () => it("inside too", () => assert.ok(1)));
test("by option", { only: true }, () => assert.ok(1));
test("not alone", { only: false }, () => assert.ok(1));
`;
	assert.deepEqual(summary("a.test.mjs", source), [
		"alone (only): 1",
		"also alone (only): 1",
		"suite › inside (only): 1",
		"other suite › inside too (only): 1",
		"by option (only): 1",
		"not alone: 1",
	]);
});

test("a Python skip decorator over several lines, or before one that is, still skips its test", () => {
	const source = `
@pytest.mark.skip(
    reason="flaky",
)
def test_one():
    assert True

@pytest.mark.skip(reason="slow")
@pytest.mark.parametrize(
    "value",
    [1, 2],
)
def test_two(value):
    assert value

def test_three():
    assert True
`;
	assert.deepEqual(summary("test_a.py", source), ["test_one (skipped): 1", "test_two (skipped): 1", "test_three: 1"]);
});

test("a Go raw string is raw: a backslash at its end doesn't swallow the tests after it", () => {
	const source = [
		"func TestPath(t *testing.T) {",
		"	if dir() != `C:\\` { t.Error(\"not C\") }",
		"}",
		"",
		"func TestTemplate(t *testing.T) {",
		"	if name() != `\${x}` { t.Fatal(\"not x\") }",
		"}",
		"",
		"func TestLast(t *testing.T) { t.Error(\"last\") }",
	].join("\n");
	assert.deepEqual(summary("a_test.go", source), ["TestPath: 1", "TestTemplate: 1", "TestLast: 1"]);
});

test("a parameterized test (.each, .for) is one test named by its template, with its skips and assertions", () => {
	const source = `
test.each([
	[1, 1, 2],
	[1, (2), 3],
])("adds %i + %i", (a, b, sum) => {
	expect(add(a, b)).toBe(sum);
});
it.each\`
	a    | b
	\${1} | \${2}
\`("table $a", ({ a, b }) => expect(a).toBeLessThan(b));
describe.each([[1], [2]])("suite %i", (n) => {
	it.skip.each([3])("inner %i", (m) => assert.ok(n < m));
});
test.only.each([1])("alone %i", (n) => assert.ok(n));
test.for([1, 2])("vitest for %i", ([n]) => expect(n).toBeTruthy());
const rows = table.each([1]);
`;
	assert.deepEqual(summary("a.test.ts", source), [
		"adds %i + %i: 1",
		"table $a: 1",
		"suite %i › inner %i (skipped): 1",
		"alone %i (only): 1",
		"vitest for %i: 1",
	]);
});

test("JSX in a test file doesn't hide the tests after it", () => {
	const source = `
import { render } from "@testing-library/react";
const Hint = () => <p className="hint">Don't click / tap (twice)</p>;
test("renders the hint", () => {
	render(<div>{/* don't */}{cond ? <Hint /> : <></>}<a href="/x">it's {"here"}</a></div>);
	expect(screen.getByText(/click/)).toBeTruthy();
});
const pick = <T,>(items: T[]) => items[0];
test("renders a list", () => {
	const view = render(
		<ul>
			<li key="a">a {\`b\`}</li>
		</ul>,
	);
	expect(view).toBeTruthy();
	expect(pick([1])).toBe(1);
});
const small = count < limit;
test("after a comparison", () => assert.ok(small));
`;
	assert.deepEqual(summary("a.test.tsx", source), ["renders the hint: 1", "renders a list: 2", "after a comparison: 1"]);
});

test("a Python test whose signature runs over several lines has its body's assertions counted", () => {
	const source = `
def test_reads(
    client,
    tmp_path,
):
    assert client.get("/") == 200
    assert tmp_path.exists()

class TestThing:
    async def test_method(
        self, fixture
    ) -> None:
        self.assertTrue(fixture)

def test_after():
    assert True
`;
	assert.deepEqual(summary("test_a.py", source), ["test_reads: 2", "TestThing › test_method: 1", "test_after: 1"]);
});
