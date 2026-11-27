# Marram

Marram is the grass planted on dunes to stop them drifting. This Marram does that for a codebase that agents write:
it makes the easy path the right one, so a mistake made once can't quietly come back.

It came out of reading about 70 defects from a real project one by one and sorting them into eight classes of mistake.
Each class got a guard, called a rung, as high up this ladder as it would go:

1. **Architecture:** the mistake can't be written.
2. **Types and lints:** the mistake can't be committed.
3. **Checks and journeys:** the mistake can't pass the gate.
4. **Review:** what's left, and each finding should add a rung above it.

Marram is those rungs, with the project taken out.

It's one package, [`@raresportan/marram` on npm](https://www.npmjs.com/package/@raresportan/marram), in four parts.
Take what you need: `react` and `playwright-core` are only needed by the parts that use them.

| Import from | For | What's in it |
|---|---|---|
| `@raresportan/marram/core/…` | Any project | Project gates, feature maps, journey evidence, ratchet lints, import boundaries, the no-comments rule, the check lint, `until`, `sooner`, `scales`; the `marram` command runs the gate, its hooks and the review-fix commit lint |
| `@raresportan/marram/node/…` | Node | `background`, `Scope`, the promise lint, the resource finder |
| `@raresportan/marram/react/…` | React | `useKeyed`, the effect finder |
| `@raresportan/marram/electron/…` | Electron | Electron session, typed IPC, layout geometry and frame rates |

## The ideas

**One gate.** "Done" means `marram gate` passed. A pre-push hook refuses code that hasn't, and a Claude Code hook sends a
turn back while it's red. Each project caches its verdict for the current Git tree, so its hooks can reuse a pass on the same code.

**Ratchets.** A rule usually can't be true everywhere on day one. So a site off the list fails with what to do instead,
an entry with no reason fails, and an entry that no longer matches fails until it's removed. The list only shrinks.

**Checks that can fail.** A check that only prints passes whatever the code does, and one that sleeps flakes. So a check
must be able to fail on what it sees, waits only through `until`, and bounds time only against how long the broken
behaviour takes.

**Named mistakes.** A commit that fixes review findings names each one's class and rung. Without that, review only ever
produces point fixes, and nobody sees a class recurring or a rung missing.

## Start with the checks your project already runs

Marram runs on Node. A gate stage can launch any executable available in the project environment.
For example, a Python service can use this `marram.config.mjs` in its Git repository:

```js
const tests = [{ name: "tests", run: ["python", "-m", "pytest"] }];
export default { gate: { logs: ".verify", tiers: { fast: tests, default: tests, full: tests } } };
```

Ignore `.verify/` in Git, install Marram as a development tool, and run `npx marram gate`.

`npx marram init` does that setup from the project's folder and leaves alone what's already there:
- it writes `marram.config.mjs`, with tiers from the `typecheck`, `lint` and `test` scripts in `package.json`, or empty
  tiers to fill;
- it adds `.verify/` to `.gitignore`;
- it installs a pre-push hook that runs `marram hook pre-push`, in `core.hooksPath`. If that isn't set, init sets it to
  `.githooks`, unless git already runs hooks from `.git/hooks`.

`npx marram doctor` lists what's still missing or wrong, and how to fix each one:
- the config, checked in full;
- a tier that runs nothing;
- a stage command that isn't on PATH;
- logs that Git doesn't ignore;
- a hook that's missing, not executable, or points at a Marram that isn't installed;
- a mistake-classes doc or probe patch that doesn't exist.

It exits 1 when there's a problem to fix.
For a plain Node CLI, a stage can run `["node", "--test"]`. The TypeScript lints and Electron adapter are optional.
For named behavioral checks, import `runJourneys` from `@raresportan/marram/core/run` and provide a session with
a `checks` array of `{ label, ok }` observations. The runner writes the report and checks feature-map citations. A
session that can't be opened, or whose `dispose` throws, fails its journey (the latter as `cleanup` in the report), and
the run goes on to the next journey.
Projects can supply their own CLI, HTTP or browser driver. Tally below demonstrates the Electron adapter.

## Tutorial: Tally

We'll build [Tally](examples/tally), a small Electron app with one button that counts and remembers the count, and fence
it as we go. The finished app is in the repository, and its gate is part of Marram's.

### 1. The gate

```bash
npm install --save-dev @raresportan/marram
```

A project says what its gate runs in `marram.config.mjs`:

```js
const npm = (name, ...args) => ({ name, run: ["npm", ...args] });
const fast = [npm("typecheck", "run", "typecheck"), npm("rules", "run", "rules")];

export default {
	gate: { logs: ".verify", tiers: { fast, default: [...fast, npm("unit", "test")], full: [...fast, npm("unit", "test"), npm("journeys", "run", "verify")] } },
	review: { classes: "docs/mistake-classes.md" },
};
```

`marram gate fast` takes seconds, for each edit. `marram gate` takes minutes, before a task counts as done. `marram gate
full` adds what's slow, before merging. Stages run in order, the first failure stops the gate, and each stage's output
is kept in its own log. On failure the terminal shows up to 60 lines starting at the first failure marker, or the last
60 lines when the log has no marker. A stage that fails after the machine slept during it runs again, because that failure says
nothing about the code.

Logs go in `gate.logs`, `.verify` unless set, one folder per run. The newest 20 runs are kept and older ones removed;
`gate.keep` sets how many (`Infinity` keeps them all). Only the gate's own `gate-<tier>-<time>-<pid>` folders are removed,
and never one whose gate is still running, such as a long gate in another terminal or hook.

Every command checks the whole config when it loads it. A misspelled key (`gate.tiers.defualt`, with the key it's likely
meant to be) or a value of the wrong kind (a stage's `run` given as one string) is listed, and nothing runs.

### 2. The hooks

```sh
# .githooks/pre-push
exec node "$(git rev-parse --show-toplevel)/node_modules/@raresportan/marram/bin/marram.mjs" hook pre-push
```

A push needs the default gate unless `gate.prePush` is `"full"`, for a project with no CI behind the push. A full pass
counts for the default gate too when it ran each default stage, in order, with the same command, arguments and `env`;
other stages may come between them. A default run afterwards doesn't replace it. A full tier that runs something else,
such as `npm run gate:full` where the default runs `npm run gate`, doesn't answer for the default gate, which then runs.

A pass counts only while the configuration gives the same stages: their commands, arguments and `env`. A configuration
can build its stages from the environment, so the same code can need other stages, and then the gate runs again.

Stages also inherit the gate's environment. An inherited variable counts only if `gate.env` names it, as in
`env: ["CI", "NODE_ENV"]`: then a pass made with one value doesn't count for another. Other inherited variables don't
count, because `PATH` and the variables a terminal or hook sets differ from run to run. Name each variable your checks
read.

Gates run on the same code with different stages keep a verdict each. The config is evaluated from the project's root,
wherever a command runs.

A verdict keeps a key for the stages it ran, not their commands or environment, which may hold secrets. The key is an
HMAC under a secret kept in its own owner-only file, `marram-gate.key` in the git folder. On Windows, where a file's mode
doesn't limit who reads it, its inherited permissions are removed with `icacls`. The gate reads its configuration once,
from the project's root, and records its verdict for the stages it ran.

```sh
# .githooks/commit-msg
exec node "$(git rev-parse --show-toplevel)/node_modules/@raresportan/marram/bin/marram.mjs" commit-lint "$1"
```

Point git at them with `git config core.hooksPath .githooks`. For Claude Code, run `marram hook claude-turn` on
`UserPromptSubmit` and `marram hook claude-stop` on `Stop`. Another agent's done-check runs `marram hook finish`.

### 3. Your mistakes

`docs/mistake-classes.md` has one table row per class of mistake, each starting with its name in bold:

```md
| Class | What goes wrong | Rungs that guard it |
|---|---|---|
| **state**: UI state that disagrees with itself | An effect copies one value into another | lint: `rules` |
```

Start with the classes you've actually seen. A commit whose subject fixes review findings then needs a line per
finding, or the `commit-msg` hook refuses it. That's a subject naming review findings, gaps, comments, feedback, notes,
nits or suggestions (PR or pull request ones too), or addressing, applying, resolving or handling review or feedback. A
project that words these its own way sets `review.subjects` to a pattern:

```
Class: state. Rung: lint (rules fails without it)
```

Run `marram review-summary --since <tag>` to see annotated findings in commits since a release. Omit `--since` for
all history reachable from HEAD. Classes with the most findings appear first, grouped by rung, with the finding,
its recorded rationale and a commit reference. GitHub origins get commit URLs. A finding with two classes appears
under each and counts once in the overall total. The summary also counts findings marked `Rung: none`.

### 4. One folder per feature

Everything a feature has lives in its folder, split by where it runs:

```
src/features/counter/
  shared/           pure types and functions, for both sides
  host/             Electron's main process: files, processes
    index.ts        what the rest of the app may import
  client/           the renderer: React
    index.ts        what the rest of the app may import
```

An import from `client` into `host` would pull main-process code into the renderer, which is how a UI gets slow. So the
import graph is a rule:

```js
import { importBoundaries } from "@raresportan/marram/core/boundaries";

importBoundaries({
	root,
	folder: "src",
	layers: {
		"features/*/shared": { may: [] },
		"features/*/host": { may: ["features/*/shared"], builtins: true },
		"features/*/client": { may: ["features/*/shared"] },
		main: { may: ["features/*/host", "features/*/shared"], builtins: true },
		preload: { may: ["features/*/shared"], builtins: true },
		renderer: { may: ["features/*/client", "features/*/shared"] },
	},
	allowed: {},
	list: "scripts/rules.mjs",
});
```

A file may import from its own layer and from the layers it lists. Another feature is reached only through an
`index.ts`, either the feature's own or that of one of its sides. Each side has its own because the main process needs
the host and the renderer the client, and one index for both would pull the host into the renderer. An index only opens
the feature: its side must still be a layer the file may import. A file in no layer, such as a feature's own index, is no
way around that: importing it counts as importing what it imports. Only a layer with `builtins: true` may import Node's
modules, as `node:fs` or `fs`, or `electron`.

### 5. The first ratchet

Tally keeps the count in one place. So the count's file is read and written only in `host/store.ts`:

```js
import { importsOf } from "@raresportan/marram/core/boundaries";
import { restrict, finish } from "@raresportan/marram/core/ratchet";

const problems = restrict({
	root: process.cwd(),
	folder: "src",
	owners: ["features/counter/host/store.ts"],
	find: importsOf("fs"),
	allowed: {},
	list: "scripts/rules.mjs",
	fix: "go through the counter's store",
	stale: "no longer touches files",
});
finish("rules", problems, "files are touched only in the store");
```

Run the script from the project root with `node scripts/rules.mjs`. An import of `node:fs/promises` outside the store
now fails with the file, line and instruction to go through the store. `importsOf(...names)` matches literal ES imports
(including type-only imports), re-exports and dynamic imports of named modules and their subpaths.

`find` takes a parsed source file and returns where it does the thing, as `{ line, what }`. A string entry in `allowed` covers all matches in that file.

To keep a legacy file at its current count, use an entry like this with the `acquisitions` finder:

```js
allowed: { "legacy/poller.ts": { count: 3, reason: "Move the three timers to Scope as their callers migrate" } }
```

A fourth match fails with the rule's fix. Removing one asks you to lower the count to two. Removing the last one
asks you to delete the entry. The count tracks how many matches the finder reports, so replacing one with another
keeps the same count.

Add `acquisitions`, `effectSets` and `lintPromises` from its `node` and `react` parts the same way.

To keep agents from leaving explanations in place of fixes, `@raresportan/marram/core/no-comments` is a finder for the same rule.
It accepts doc comments on declarations outside a function's body (in a module, a class, an interface or an object), license
headers and comments with a link. A `/** … */` comment on a statement or inside a function is flagged like any other.

### 6. The first journey

A journey drives the built app as a user would:

```ts
export async function counts(session: Session): Promise<void> {
	await session.launch();
	const button = () => session.page.getByRole("button", { name: /Count/ });
	await button().click();
	await session.check("One click counts one", async () => (await button().textContent()) === "Count: 1");
	await session.close();
	await session.launch();
	await session.check("The count survives a restart", async () => (await button().textContent()) === "Count: 1");
}
```

`Session` extends `JourneySession` with what your app needs, and `session.launch` calls its `start`. A check given a
function polls it, and must be awaited: `lintJourneys` fails on one that reads the page once, or that nobody awaits.
`runJourneys` fails a journey that checked nothing. `staleInput` refuses a build older than its sources, because a
journey runs the build, and a change it hasn't seen would pass.

### 7. The feature map

`docs/feature-map.md` lists every feature, how a user reaches it, and what verifies it:

```md
- **Counting.** Click the button; the count goes up and survives a restart.
  - ✅ counts › "One click counts one"
  - ✅ counts › "The count survives a restart"
```

`checkFeatureMap` fails when a cited check doesn't exist, or a feature doesn't say how it's verified. A known gap is a
`❌` line, left visible.

## Beyond the tutorial

### Runtime evidence for a feature map

Pass `featureMap: { path }` to `runJourneys` when running the whole map. Each journey citation must resolve to a
passing journey in that run, and each named check must appear among its passed observations. The runner records gaps in
`missing-citations.json` beside the normal report. Use the static feature-map check for partial runs. For custom
citations verified by another checker, supply their patterns in `featureMap.custom`.

Run `marram map-diff origin/main docs/feature-map.md` from the project root in PR review to list verification
obligations removed since the merge base. Removals are informational so a maintainer can review intentional changes.

### What a green gate means after a change

A change can weaken the checks that judge it and still pass them: move a journey from the default gate to the full one,
or add a flag to the script a stage runs. Run `marram guard-diff origin/main` in PR review to see what the branch
changed in its guards since the merge base:

- each project's gate tiers (every `marram.config.mjs` in the repository, including one deleted): stages removed,
  added, reordered, or running different arguments, and where a removed stage still runs with the same arguments and
  `env`;
- `env` changes, by variable name only, since a value may be a token;
- `gate.prePush`, and the inherited variables `gate.env` stops or starts counting for reusing a pass;
- the `package.json` scripts a stage runs, in each workspace its command names with `-w` and, for npm, the `pre` and
  `post` scripts around them. Each is found in its own revision and matched by the stage that runs it (its tier, name,
  and which of that name it is there), so a workspace renamed under an unchanged command, or a script changed along with
  the stage's arguments, shows what now runs, and stages of the same name in two tiers each have theirs compared;
- the files in `core.hooksPath`, and in each `--hooks <folder>` given, tracked or not. A fresh checkout, as in CI, has
  no `core.hooksPath`, so CI names the folder. Hooks outside the repository are listed as not compared;
- probes: faults removed or added, a field of one changed, or its patch's contents, and the `setup`, `link` and
  `timeoutMs` that prepare their copy;
- tests in the test files the branch changed: tests removed, newly skipped, newly run alone (`.only`), or making fewer
  assertions, and test files removed or renamed to a name that isn't a test file's;
- citations removed from each feature map named with `--map <path>`, relative to where you run it.

Like map-diff, it reports and exits 0, leaving the decision to the reviewer.

Tests are read from each revision's source, not run. A test file is one with the usual names: `*.test.*`, `*.spec.*`,
anything under a `test`, `tests`, `__tests__` or `spec` folder, `test_*.py`, `*_test.py` and `*_test.go`. Tests are
read in JavaScript and TypeScript (node:test, Jest, Vitest and Mocha: `describe`, `suite`, `context`, `test`, `it` and
`specify`, skipped with `.skip`, `.todo`, an `x` prefix or `{ skip }`, run alone with `.only`, an `f` prefix or
`{ only }`; a call on another object, such as `pattern.test("…")`, isn't a test unless it's on the enclosing test's
context, as node:test's subtests are; a parameterized `test.each(…)("…")` or Vitest `test.for(…)("…")` is one test,
named by its template; JSX in the file is skipped over), Python (pytest and unittest: `def test_…`, in
classes too, skipped with a `skip`, `skipif` or `xfail` decorator) and Go (`func TestX(t *testing.T)`, skipped with
`t.Skip`). An assertion is a call to `assert…` or `expect(…)`, `self.assert…` or `pytest.raises(…)`, or `t.Error…`,
`t.Fatal…`, `assert.…` and `require.…`. A skip or an assertion made as a test runs or in a helper it calls isn't seen,
and neither is a journey a script stops choosing or a script run by a stage's script. Each configuration is evaluated in its own process, from its project folder in a temporary checkout of
the merge base or in the working tree, so each side reads its own files. A temporary checkout has no `node_modules`,
so a configuration that imports a dependency may not load there; the output says which, and compares the rest.

### Replay a regression on two revisions

Commit the candidate fix and its regression test. From the project root, run
`marram replay <base-ref> <test-file> "<test name>" "<assertion message>"`, naming the node:test `test()` or `it()` that
makes the assertion (not a `describe()` around it).
Use an explicit message on the assertion that demonstrates the defect. The command copies the committed HEAD test
file into two temporary Git clones and runs the named test against each revision. Its JSON output records both
commit IDs and observations. Success requires the named assertion failure on the base and a pass on HEAD.
Skipped tests, setup errors, other failures, and checks that pass on both revisions cannot demonstrate a fix.

If the project needs dependencies or a build, configure a setup command such as `replay: { setup: ["npm", "ci"] }`; it can also run a project script, as in `["node", "scripts/setup.mjs"]`.
Setup runs independently in each checkout. The selected test file should exercise behavior available on both revisions.
The setup and the test each get five minutes on each side; set `replay: { timeoutMs }` to change that. One that runs
longer is stopped and that side is inconclusive. It and everything it started get SIGTERM, then SIGKILL five seconds
later if they're still running, so one that ignores SIGTERM can't hang replay. On Windows its whole tree is ended at
once. A probe's check is stopped the same way at `probes.timeoutMs`.

### Typed Electron IPC

Declare operations with the argument and reply types in shared code, for example
`defineIpc("counter", { increment: operation<() => number>() })`. Import both helpers from
`@raresportan/marram/electron/ipc`. In the host, call `contract.handle(register, handlers)` with a handler
for each operation. In preload, `contract.client(invoke)` builds the matching promise-returning methods.
Tally's counter demonstrates both Electron adapters. The contract checks TypeScript callers and handlers at build
time, not at run time, so validate untrusted arguments in the handlers. `register` receives each channel's handler,
which takes Electron's event first, so it is the place to check the sender:

```ts
counterIpc.handle((channel, handler) => ipcMain.handle(channel, (event, ...args) => {
	if (event.senderFrame?.url !== trustedUrl) throw new Error(`${channel} from an untrusted frame`);
	return handler(event, ...args);
}), handlers);
```

### Probes: does the gate still catch what it was built to catch?

Replay shows that a test caught a bug once. A probe keeps checking that the gate still catches it. Keep a patch that
puts the defect back, made with `git diff > probes/no-rollback.patch` and then reverted, and name the check that must
catch it:

```js
probes: {
  setup: ["npm", "ci"],        // optional: run once in the copy, before the faults
  link: ["node_modules"],      // optional: ignored paths shared from the working tree instead of rebuilt
  timeoutMs: 300000,           // optional: for each command
  faults: [
    { name: "a failed transfer rolls back", patch: "probes/no-rollback.patch",
      run: ["pytest", "tests/test_transfer.py"], expect: /balance unchanged/ },
    { name: "a stored zero", patch: "probes/zero.patch",
      test: { file: "test/store.test.mjs", name: "reads one", assertion: "stored value" } },
  ],
},
```

`marram probe` copies the working tree, uncommitted changes included, as the gate sees it. For each fault, the check
runs clean and must pass. It runs again with the patch applied and must fail: a `run` command with output matching
`expect` (a RegExp, or text it must contain), or a node:test `test` at the assertion with that message, judged as replay
judges it. Each fault is reported caught, missed (the check passed with the defect in place, so that defect can pass the
gate again), or inconclusive (the clean run failed, the patch no longer applies, or the check failed for another
reason). The command exits 1 unless every fault is caught. `marram probe "<name>"` runs the faults named.

Paths and commands are the project's; a fault's `cwd` changes where its command runs. Patches apply at the repository
root. Each fault then runs in the copy as setup left it, ignored build output included. Files a check made are removed,
and files it changed are put back, even a patched file a check rewrote. The patched files get their times back too
(renamed files included), so a build tool doesn't see stale sources. Linked paths are shared, so they aren't put back.

A linked path must exist in the working tree and be ignored there. It's shared, not copied, and git refuses a patch
that reaches through it. A linked folder with links in it, such as `node_modules` with its workspace packages, scopes
and `.bin`, is made again in the copy. Each of its links that leads into the repository leads to the same place in the
copy instead, so a fault patched into a workspace package is the one its check loads. A folder counts when it has a
link in it or one level below, as scoped packages do. Links nested deeper still lead to the working tree.

Marram probes three of its own guards this way, in the full gate: a shared cache verdict across nested projects, a
missing IPC handler, and a restart check left in an uncalled helper. The patches are in `probes/`. They need the same
Electron environment as Tally's journeys. Each command gets five minutes; set `PROBE_TIMEOUT_MS` to change that.

## Credit

The approach, and terms such as the trust ladder and the feature map, come from Lauren Tan's talk ["here's how i shipped
2,500 PRs last month to production"](https://x.com/poteto/status/2102050467505430555), about a framework called Dune.
Marram is a separate project, with no code from it.

## What Marram doesn't do

- **It has no runtime.** Feature discovery and routing are project-owned. Electron projects can opt into the typed IPC helper. The folder convention is enforced by rules,
  and you wire the features up yourself.
- **It can't judge.** The commit lint checks that a class and a rung are named, not that they're right.
- **Hooks can be skipped.** `--no-verify` skips them. There's no server-side enforcement unless your CI runs the gate,
  as Marram's own does (see Developing Marram).

## Developing Marram

`npm run gate` runs the packages' tests and Tally's own gate. A change to a rule comes with a test that fails without it.

The package's TypeScript modules are compiled in place, to `.js` and `.d.ts` beside each `.ts`, by
`npm run build -w @raresportan/marram`. A build compiles into a scratch folder of its own, then renames each file into
place, so builds that overlap don't delete each other's output and anything reading the package always finds every
file. Last, it removes what a deleted `.ts` left, so that leaves nothing to publish. `npm install` runs it, the gate runs it first, and `npm pack` runs it again.
Only the compiled files are published, so a project on Marram runs it in plain Node and with any bundler. Tally imports
the compiled files too, so after editing a `.ts` file outside the gate, build before running Tally.

`node scripts/lint-cost.mjs [files…]` measures the ratchet lints on a corpus of 1000 and 5000 files (or the sizes
given). It reports how long they take, how much of that is parsing the same files again, and the memory that keeping
every parsed file would take. Use it to decide whether a runner that parses each file once is worth building. Its header
has the last numbers: at most 0.6s saved per thousand files, so not yet.

CI (`.github/workflows/gate.yml`) runs `npm run gate:full` on every pull request and on main, on Ubuntu under
`xvfb-run` and on Windows, and keeps each platform's gate logs when it fails. On Windows, a command a stage, probe or
replay setup names that's installed as a `.cmd` or `.bat` script, such as `npm`, runs through `cmd.exe`, since Node
won't start one directly. For a pull request it also runs `marram guard-diff` against the
base branch and shows the result in the run's summary and in one comment on the pull request, edited on each push and
posted only once the branch changes a guard. guard-diff runs the pull request's code, so its job has a read-only token.
The comment comes from a second workflow, `guard-report.yml`, which runs from the default branch's definition when the
gate finishes. It posts the first job's output as text, for pull requests from forks too, and never runs the pull
request's code. A guard-diff that fails fails its job, and the comment says it failed.

A project using Marram can do the same: run its full gate where its UI checks can open a window, and report guard-diff
to the reviewer.

## License

MIT
