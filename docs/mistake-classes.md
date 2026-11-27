# Mistake classes

Marram's own defects, by class. A fix for a review finding names its class and the rung that now guards it, so each
finding either strengthens a rung or shows that one is missing.

| Class | What goes wrong | Rungs that guard it |
|---|---|---|
| **rule**: a rule that misses what it's for | A lint passes on the mistake it exists to catch, or flags what it should allow | unit: each rule's tests, each failing with its fix reverted |
| **seam**: a project's detail inside a package | A path, name or habit of one project makes a package useless to another | architecture: projects pass their details in; lint: `scripts/independent.mjs`; journey: Tally builds on the packages too |
| **check**: a check that can't fail or that flakes | A check that only prints; a hand-rolled wait; a clock bound | lint: `@raresportan/marram/core/check-lint`, `@raresportan/marram/electron/journey-lint` |
| **key**: a verdict kept under a key that misses what it depends on | A stage's setting, the folder a config is read from, or the version that wrote a verdict changes what a run does, but not its key, so a pass is reused for code or stages it never judged | unit: `hook.test.mjs`, a case per input. Missing: one list of stage fields that the key, the config check and guard-diff all read |
| **blind**: a comparison that reports nothing for a change it doesn't know | guard-diff lists what it compares, so a new kind of change (a setting, a rename into a test file's name, a new test syntax) shows as "No guard changes" | unit: `guard-diff.test.mjs`, `test-inventory.test.mjs`. Missing: a change guard-diff can't read is reported as not compared |
| **lifetime**: a process taken as done before it is | A command counted as finished when it exits, while a process it started still holds its output; a process that exits before what it wrote has reached a slow reader | unit: `bounded.test.mjs`, the slow-pipe tests in `gate.test.mjs` and `guard-diff.test.mjs`. Missing: a lint that allows `process.exit` only in `exitWhenWritten`; macOS in CI, where the pipe tests fail |
| **shared**: a place written to as if no one else used it | Two runs, builds or probes in one folder; a folder named by the time alone; a gate's logs pruned while it runs; a hook written into a folder other repositories or worktrees use | unit: `probe.test.mjs`, `build.test.mjs`, `setup.test.mjs`, the overlapping-gate tests. Missing: one helper that gives a run its own folder, writes by rename and removes only what it made |
| **attribution**: a verdict right for the wrong reason | A probe reports a fault caught because its check failed on something else; replay takes a base that failed for another reason as proof | unit: `probe.test.mjs` with an unrelated patch, `replay.test.mjs`. Missing: each probe run checks that an unrelated patch is missed |
| **leak**: a value kept where it outlives its use | A stage's command or `env`, which may hold a token, written to state, a command line or a token a pull request's code can read | unit: tests that read the state a command writes for a known value |
| **platform**: code that assumes one operating system | A path compared in one spelling or with one separator, a command started as one platform starts it, a signal or rename only POSIX has | check: CI's full gate on Linux and Windows; unit: tests that give the other platform's paths or a fake of its environment |

`check` is only a check that can't fail or that flakes. A tool that judges wrongly is in the class for how it does: a
wrong key, a change it can't see, a process it stops waiting for, a place it shares, or a cause it gets wrong.

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
