# Mistake classes

Marram's own defects, by class. A fix for a review finding names its class and the rung that now guards it, so each
finding either strengthens a rung or shows that one is missing.

| Class | What goes wrong | Rungs that guard it |
|---|---|---|
| **rule**: a rule that misses what it's for | A lint passes on the mistake it exists to catch, or flags what it should allow | unit: each rule's tests, each failing with its fix reverted |
| **seam**: a project's detail inside a package | A path, name or habit of one project makes a package useless to another | architecture: projects pass their details in; lint: `scripts/independent.mjs`; journey: Tally builds on the packages too |
| **check**: a check that can't fail or that flakes | A check that only prints; a hand-rolled wait; a clock bound; a pattern with the g or y flag that misses every other text | lint: `@raresportan/marram/core/check-lint`, `@raresportan/marram/electron/journey-lint`, `scripts/rules.mjs` (patterns a file didn't write go through `pattern.mjs`) |
| **key**: a verdict kept under a key that misses what it depends on | A stage's setting, the folder a config is read from, or the version that wrote a verdict changes what a run does, but not its key, so a pass is reused for code or stages it never judged | architecture: `STAGE_FIELDS` in `config.mjs`, one list the key and the config check read; unit: `config.test.mjs` changes each field and checks the key |
| **blind**: a comparison that reports nothing for a change it doesn't know | guard-diff lists what it compares, so a new kind of change (a setting, a rename into a test file's name, a new test syntax) shows as "No guard changes" | architecture: `FIELDS` in `config.mjs` says what guard-diff reports, and a field it doesn't know is reported as changed; unit: `guard-diff.test.mjs` changes each field, `test-inventory.test.mjs` |
| **lifetime**: a process taken as done before it is | A command counted as finished when it exits, while a process it started still holds its output; a process that exits before what it wrote has reached a slow reader | lint: `scripts/rules.mjs` allows `process.exit` only in `exitWhenWritten`; check: CI's full gate on macOS, where the slow-pipe tests fail; unit: `bounded.test.mjs`, the slow-pipe tests |
| **shared**: a place written to as if no one else used it | Two runs, builds or probes in one folder; a folder named by the time alone; a gate's logs pruned while it runs; a hook written into a folder other repositories or worktrees use | architecture: `owned.mjs` gives a run its own folder, writes a file whole, removes only what's done and takes a lock only from a holder that's gone; check: `models/Lock.tla`, every interleaving of the lock's steps with any process pausing or dying anywhere, checked by everystate in the gate (`scripts/models.mjs`); lint: `scripts/rules.mjs` lists every other write, rename or removal with why its place is the run's alone; unit: `owned.test.mjs`, `probe.test.mjs`, `build.test.mjs`, the overlapping-gate tests |
| **attribution**: a verdict right for the wrong reason | A probe reports a fault caught because its check failed on something else; replay takes a base that failed for another reason as proof | check: a probe counts a fault caught only if its check passes again without it; unit: `probe.test.mjs`, `replay.test.mjs` |
| **state**: a state machine nobody wrote down | A lifecycle kept in flags that callbacks set: some combination no one meant can happen, and some event in some state has no outcome anyone chose (a second report, a timeout that no longer covers what's left) | architecture: `machine.mjs`, a table with every event's outcome in every state; unit: `machine.test.mjs` goes through the table's pairs and checks the timers alone end it; lint: `scripts/rules.mjs` flags a function whose callbacks set two or more of its variables |
| **leak**: a value kept where it outlives its use | A stage's command or `env`, which may hold a token, written to state, a command line or a token a pull request's code can read | unit: tests that read the state a command writes for a known value; check: zizmor over the workflows in CI |
| **platform**: code that assumes one operating system | A path compared in one spelling or with one separator, a command started as one platform starts it, a signal or rename only POSIX has | check: CI's full gate on Linux, Windows and macOS; unit: tests that give the other platform's paths or a fake of its environment |

`check` is only a check that can't fail or that flakes. A tool that judges wrongly is in the class for how it does: a
wrong key, a change it can't see, a process it stops waiting for, a place it shares, a cause it gets wrong, or an event
it never decided about.

## Naming a fix

For each finding, the commit body has a line:

```
Class: rule. Rung: unit (ratchet.test.mjs fails without it)
```

A defect that fits no class is `Class: new`, and its class is added here in the same change. If nothing could catch it,
write `Rung: none, because …`: that's a missing rung.

A unit test pins the case found. When the rung is `unit`, say what rung above it would catch the class (a type, a lint,
an architecture that can't express the mistake) and why it isn't there yet. If the same class comes up again in the
same place, build that rung instead of adding another unit test.

## Before writing the fix

Most fixes so far needed a second or third round, each for a case close to the last one. Before committing, try the fix
on the other forms of what it handles:

- **A path:** relative, absolute, a link, on another drive, inside `.git`, in another worktree, a global setting.
- **A process:** exits at once, ignores SIGTERM, starts a detached process, leaves a grandchild, is interrupted, runs on
  Windows.
- **A change to files:** added, renamed into or out of a name, deleted, edited to the same size, an empty folder.
- **A configuration:** a getter, a value from `process.cwd()`, state written by the previous version.
- **A pattern:** with the g or y flag.
- **A fix in one place:** every other place with the same code. Better, one function they all call.
