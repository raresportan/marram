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

It's one package, `@raresportan/marram`, in four parts. Take what you need: `react` and `playwright-core` are only needed
by the parts that use them.

| Import from | For | What's in it |
|---|---|---|
| `@raresportan/marram/core/…` | Any project | Ratchet lints, import boundaries, the no-comments rule, the check lint, `until`, `sooner`, `scales`; the `marram` command runs the gate, its hooks and the review-fix commit lint |
| `@raresportan/marram/node/…` | Node | `background`, `Scope`, the promise lint, the resource finder |
| `@raresportan/marram/react/…` | React | `useKeyed`, the effect finder |
| `@raresportan/marram/electron/…` | Electron | Journeys: `JourneySession`, `runJourneys`, the stale-build guard, layout geometry, frame rates, the feature map, the journey lint |

## The ideas

**One gate.** "Done" means `marram gate` passed. A pre-push hook refuses code that hasn't, and a Claude Code hook sends a
turn back while it's red. The verdict is kept per working tree, so code that passed isn't checked again.

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
is kept in its own log.

### 2. The hooks

```sh
# .githooks/pre-push
exec node "$(git rev-parse --show-toplevel)/node_modules/@raresportan/marram/bin/marram.mjs" hook pre-push
```

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
the host and the renderer the client, and one index for both would pull the host into the renderer. Only a layer with
`builtins: true` may import `node:` modules or `electron`.

### 5. The first ratchet

Tally keeps the count in one place. So the count's file is read and written only in `host/store.ts`:

```js
import { restrict, finish, lineOf } from "@raresportan/marram/core/ratchet";

const problems = restrict({
	root,
	folder: "src",
	owners: ["features/counter/host/store.ts"],
	find: fileAccess,
	allowed: {},
	list: "scripts/rules.mjs",
	fix: "go through the counter's store",
	stale: "no longer touches files",
});
finish("rules", problems, "files are touched only in the store");
```

`find` takes a parsed source file and returns where it does the thing, as `{ line, what }`. A file that's listed needs a
reason. Add `acquisitions`, `effectSets` and `lintPromises` from its `node` and `react` parts the same way.

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
