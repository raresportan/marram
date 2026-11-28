# Changelog

Changes to `@raresportan/marram`, newest first. Earlier versions (0.2.3 and before) have no entries here.

## Unreleased

### Fixed

- **TypeScript 7.0 on Windows**: the typed lints (`lintPromises`, `lintJourneys`) couldn't open the program they build,
  since the compiler asks for the config Marram serves it with forward slashes, and Marram kept it with backslashes.
- **`readOnce` on TypeScript 7.0**: its type took a checker from `typescript/unstable/async`, whose promises it can't
  read, so it reported nothing. It now takes only a synchronous checker (`typescript/unstable/sync`).

## 0.5.0 — 2026-11-28

### Added

- **TypeScript 7.0**: the lints run on `typescript` 7.0 (what `npm install typescript` gives now) as well as 5. The peer
  range is `^5.9.3 || ~7.0.2`. 7.0's JavaScript API isn't 5's, so on 7.0 the lints read code through an adapter that
  gives them the part of 5's API they use. 7.1 changes that API again: until it's adapted, the lints say so there, with
  the command that installs TypeScript 5 beside it.

## 0.4.0 — 2026-11-28

### Added

- **Probes**: a fault counts as caught only if its check passes again without the patch, run from the same reset copy.
  One that fails again is inconclusive, since its failure may not be the patch's.
- **guard-diff** reports a change to any config field it has no comparison of its own for: `gate.sleepGapMs`, `replay`'s
  and `review`'s, with their values, and a field Marram doesn't read, anywhere in the config, without its value.
- **Ratchets**: `runRules` and `sourceFiles` take `match`, the files to read by name, so rules can run over JavaScript
  modules.

### Changed

- **`finish`** (`core/ratchet`) returns a promise, and fails only once its list is written: await it. Without `await`
  it still fails, but a promise lint flags the call.
- **Interrupted commands**: replay's setup and test, a probe's check and setup, and a node:test run that's interrupted
  come back as an error with code `EINTR`, so they're inconclusive, whatever the command exited with as it cleaned up.
- **Probes**: a caught fault's check runs three times rather than two (clean, with the patch, clean again).
- **Electron**: each session's bootstrap is `bootstrap-<session>.mjs` in `appDir` rather than `bootstrap.mjs`, and is
  removed when the session is disposed if it isn't in the session's scratch folder.
- **The command supervisor** (replay, probes, node:test runs) keeps its lifecycle in one table, with every event's
  outcome in every state, rather than in flags its callbacks set. Once it has said how a command ended, nothing makes
  it say so again, and a second interruption is passed on without starting the grace period over.

### Fixed

- **TypeScript 7**: with `typescript` 7 installed (what `npm install typescript` gives now), the lints said "Cannot read
  properties of undefined". TypeScript 7's JavaScript API isn't 5's, which they read code with, so they now say that,
  with the command that installs TypeScript 5 beside it.
- **Replay and probe**
  - A command whose output goes to the terminal (replay's setup, a node:test run) colours it again.
    - Since 0.3.1 its output comes through a pipe, so commands that colour only for a terminal stopped. Marram now sets
      `FORCE_COLOR=1` for it when its own output is a terminal, unless the project's environment sets `FORCE_COLOR`
      or `NO_COLOR`. Output that marram captures and matches stays plain.
  - An interrupted command that cleaned up and exited 0 could be taken for a pass. Replay's and the probes' setup,
    which looked only at the exit status, refuse it too.
  - After a timeout or an interruption, a worker in the command's process group that ignored SIGTERM, with its output
    sent elsewhere, was left running once the command's output closed. The supervisor now waits for the group to be
    gone, so the worker gets SIGKILL after the grace period. A second after SIGKILL it stops asking the group, so a
    worker that exited but that its parent hasn't reaped doesn't keep the caller waiting.
- **Patterns**: `gate.progress`, a probe's `expect` and the check lint's `match` work whatever their `g` or `y` flags.
  Before, `gate.progress: /step/g` showed every other matching line, and `lintChecks` read every other check file.
- **Output**: a ratchet lint's `finish`, and every other way the commands exit, wait for what they wrote. Before, a
  lint's list of problems longer than 64 KB reached a slow reader cut short.
- **Shared places**
  - The gate's `report.json` and the journeys' `report.json` and `missing-citations.json` are written whole. Before, a
    reader during a run (an agent, a CI step) could read half a file.
  - A gate that died holding the state file's lock no longer keeps others waiting, and one still working holds it,
    however long. Before, the lock was taken from any holder after 10 seconds.
  - `marram init`'s pre-push hook is executable from the moment it's there. Before, a push in that moment skipped it.
  - Journeys running at once with the same `appDir` could start each other's profile, through one shared
    `bootstrap.mjs`.
  - Two processes could both hold the state file's lock: one that judged the holder gone and paused removed the lock
    another had taken meanwhile, a lock could be taken before its owner wrote its marker, and one whose recoverer
    died partway was taken after 10 s while its holder worked. The lock is now a folder of numbered generations, each
    published whole by a rename only one process wins, and no process moves or removes one that's held. It's
    `marram-gate.json.locks`, so a 0.3 gate running at the same moment doesn't share it.

## 0.3.1 — 2026-11-27

### Fixed

- **Gate and hooks**
  - A full gate answers for the default gate only when it runs the default's stages in the same groups.
    - Before, a full gate that ran stages together, or ran apart stages the default runs together, could pass, and the
      hooks reused that pass for a default gate that fails on the same tree.
    - `concurrent` is now part of a stage's key, and coverage compares the groups each tier runs.
    - A covering pass recorded by 0.3.0 no longer counts, so the default gate runs once after the upgrade. Other passes
      still count.
  - `marram init` no longer writes its pre-push into a hooks folder outside the repository, where every other
    repository would run it. That covers a global `core.hooksPath` and a `.githooks` that links elsewhere. It says what
    to do instead.
- **Probes and replay**
  - A probe's patched run starts from the copy as setup left it, empty folders included. Before, a check that failed on
    the clean run's leftovers, or on a folder the reset removed, was reported as catching the fault.
  - A command's timeout covers whatever holds its output: processes it left in its group, and ones it started in a group
    of their own. Before, a replay setup or probe check could run past `timeoutMs` and still report success.
  - `marram replay` with `--expect` but no `-- <command>` prints the usage, rather than looking for a test named
    `--expect`.
- **guard-diff**
  - Reports a test run alone (`.only`) in a test file the branch adds, or in a file renamed to a test file's name.
  - Reports stages that start or stop running together (`concurrent`).
- **Output**: guard-diff's report, `--json` documents and the gate's failure output are written whole before the
  command exits. Before, a slow reader, such as a CI step, could get them cut off at 64 KB.
- **Patterns**: citation patterns, in the static check and in runtime evidence, and `review.subjects` match every citation
  or subject, whatever their `g` or `y` flags. A sticky pattern still matches only from the start.
- **Ratchets**: an import-boundary entry whose file was deleted says it's gone.

## 0.3.0 — 2026-11-27

### Added

- **`marram init`** sets a project up: a `marram.config.mjs` built from its npm scripts, `.verify/` ignored, and a
  pre-push hook. **`marram doctor`** says what's missing or wrong in that setup.
- **`marram guard-diff <base>`** reports what a branch changed in the checks that judge it:
  - the gate's tiers and stages, and `gate.env`;
  - the package scripts a stage runs, in each workspace it names (`-w`, `--workspaces`), with npm's pre and post scripts;
  - hooks, and probes;
  - tests removed, newly skipped, run alone or emptied of assertions (JavaScript and TypeScript, Python, Go);
  - citations removed from a feature map.

  CI posts it on each pull request.
- **`marram probe`** puts known defects back, one patch at a time, in a copy of the working tree, and checks that the gate
  still catches each one.
- **`marram replay <base> …`** shows a fix on two revisions: the regression test fails on the base, with the expected
  assertion, and passes on HEAD.
  - It works with any test runner: `--expect "<text>" -- <command>`.
  - It has a setup command, and a timeout that stops what the test started.
- **Concurrent gate stages:** a stage marked `concurrent: true` runs alongside the stages next to it that are marked too.
- **`--json`** on `gate`, `probe`, `guard-diff` and `review-summary`: the result as JSON on stdout, the usual lines on
  stderr.
- **`runRules`** (`core/ratchet`) runs several ratchet rules over one parse of each file. `importBoundaryRule`
  (`core/boundaries`) puts the import boundaries in with them.
- **`importsOf`** (`core/boundaries`) is a ratchet finder for imports of named modules, so only their owner uses them.
- **`marram review-summary`** groups review-fix findings by mistake class and rung.
- **Typed Electron IPC** (`electron/ipc`): the host's handlers and the preload's methods come from one contract.
- **Runtime evidence for a feature map:** journeys record what they checked, and a citation of a check that never ran
  fails (`core/run`, `core/feature-map`, `core/journey-lint`).
- **`gate.keep`** keeps the newest runs' logs (20 unless set), and never removes the logs of a gate still running.
- **Declarations** for every module the package exports.

### Changed

These may need something from you when you upgrade.

- **The config is checked as a whole when it loads,** whichever command runs. A misspelled key or a value of the wrong
  kind is now an error that names it, where before it was ignored.
- **The TypeScript modules are published compiled** (`.js` with `.d.ts`). Plain Node and any bundler can import them;
  `tsx` isn't needed.
- **A gate verdict counts only while the configuration gives the stages it ran.** That covers their commands, arguments
  and `env`, and the inherited variables that `gate.env` names. A full pass counts for the default gate only when it ran
  the default stages.
- **`replay`** treats a base that fails the assertion and something else too (a teardown hook, say) as inconclusive, not
  proof.
- **Import rules** tell a builtin reachable only as `node:` (`node:sqlite`) from a package with its bare name (`sqlite`).
- **The React effect lint** reads only React's own `useEffect` and `useState`: bare, or on `React` or a name "react" is
  imported as.
- **`defineIpc`** refuses an operation keyed by a symbol, as a type error and at runtime.
- **`no-comments`** allows a doc comment only on a declaration.
- **`commit-lint`** checks more review-fix subjects: review comments, PR feedback, nits.

### Fixed

- **Gate and hooks**
  - A same-size edit is no longer missed when the gate hashes the working tree.
  - A nested project's pass no longer satisfies the root project's hook.
  - Overlapping builds and log pruning are safe.
- **Commands**
  - A setup or test past its timeout, and what it started, is stopped, with SIGKILL after a grace period.
  - Each probe fault runs in the copy as setup left it.
- **Journeys**
  - A journey session that can't be opened or closed fails its journey, and the run goes on.
- **Windows**
  - `.cmd` and `.bat` commands run through `cmd.exe`, even where PATHEXT leaves them out.
  - A relative folder on PATH is found from the stage's folder.
  - Windows is covered by the full gate in CI.
- **Feature maps**
  - A citation pattern with the `g` or `y` flag matches every line it should.
