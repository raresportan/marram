# Mistake classes

Marram's own defects, by class. A fix for a review finding names its class and the rung that now guards it, so each
finding either strengthens a rung or shows that one is missing.

| Class | What goes wrong | Rungs that guard it |
|---|---|---|
| **rule**: a rule that misses what it's for | A lint passes on the mistake it exists to catch, or flags what it should allow | unit: each rule's tests, each failing with its fix reverted |
| **seam**: a project's detail inside a package | A path, name or habit of one project makes a package useless to another | architecture: projects pass their details in; lint: `scripts/independent.mjs`; journey: Tally builds on the packages too |
| **check**: a check that can't fail or that flakes | A check that only prints; a hand-rolled wait; a clock bound | lint: `@raresportan/marram/core/check-lint`, `@raresportan/marram/electron/journey-lint` |

## Naming a fix

For each finding, the commit body has a line:

```
Class: rule. Rung: unit (ratchet.test.mjs fails without it)
```

A defect that fits no class is `Class: new`, and its class is added here in the same change. If nothing could catch it,
write `Rung: none, because …`: that's a missing rung.
