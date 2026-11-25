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
| `@raresportan/marram/core/…` | Any project | Ratchet lints, import boundaries, the no-comments rule, the check lint, `until`, `sooner`, `scales`; the `marram` command runs the gate, its hooks and the review-fix commit lint |
| `@raresportan/marram/node/…` | Node | `background`, `Scope`, the promise lint, the resource finder |
| `@raresportan/marram/react/…` | React | `useKeyed`, the effect finder |
| `@raresportan/marram/electron/…` | Electron | Journeys: `JourneySession`, `runJourneys`, the stale-build guard, layout geometry, frame rates, the feature map, the journey lint |

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

### 2. The hooks

```sh
# .githooks/pre-push
exec node "$(git rev-parse --show-toplevel)/node_modules/@raresportan/marram/bin/marram.mjs" hook pre-push
```

A push needs the default gate unless `gate.prePush` is `"full"`, for a project with no CI behind the push. A full pass
counts for the default gate too, and a default run afterwards doesn't replace it.

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
finding, or the `commit-msg` hook refuses it:

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
It accepts doc comments on declarations, license headers and comments with a link.

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

### Replay a regression on two revisions

Commit the candidate fix and its regression test. From the project root, run
`marram replay <base-ref> <test-file> "<top-level node:test name>" "<assertion message>"`.
Use an explicit message on the assertion that demonstrates the defect. The command copies the committed HEAD test
file into two temporary Git clones and runs the named test against each revision. Its JSON output records both
commit IDs and observations. Success requires the named assertion failure on the base and a pass on HEAD.
Skipped tests, setup errors, other failures, and checks that pass on both revisions cannot demonstrate a fix.

If the project needs dependencies or a build, configure a setup command such as `replay: { setup: ["npm", "ci"] }`; it can also run a project script, as in `["node", "scripts/setup.mjs"]`.
Setup runs independently in each checkout. The selected test file should exercise behavior available on both revisions.

## Credit

The approach, and terms such as the trust ladder and the feature map, come from Lauren Tan's talk ["here's how i shipped
2,500 PRs last month to production"](https://x.com/poteto/status/2102050467505430555), about a framework called Dune.
Marram is a separate project, with no code from it.

## What Marram doesn't do

- **It has no runtime.** There's no feature discovery, typed IPC or routing. The folder convention is enforced by rules,
  and you wire the features up yourself.
- **It can't judge.** The commit lint checks that a class and a rung are named, not that they're right.
- **Hooks can be skipped.** `--no-verify` skips them. There's no server-side enforcement unless your CI runs the gate.
- **It ships TypeScript sources.** Your build has to bundle what your app imports from it, and scripts run with `tsx`.

## Developing Marram

`npm run gate` runs the packages' tests and Tally's own gate. A change to a rule comes with a test that fails without it.

## License

MIT
