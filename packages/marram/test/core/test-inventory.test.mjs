// Reading a test file's tests from its source: names, skips and how many assertions each makes. Run: npm test -w @raresportan/marram
import assert from "node:assert/strict";
import { test } from "node:test";
import { isTestFile, testsIn } from "../../src/core/test-inventory.mjs";

const summary = (path, source) => testsIn(path, source).map(({ name, skipped, assertions }) => `${name}${skipped ? " (skipped)" : ""}: ${assertions}`);

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
