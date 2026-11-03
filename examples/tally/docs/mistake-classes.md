# Mistake classes

| Class | What goes wrong | Rungs that guard it |
|---|---|---|
| **side**: code on the wrong side | The renderer imports what only the main process can run | lint: `rules` (`importBoundaries`) |
| **state**: UI state that disagrees with itself | An effect copies one value into another | lint: `rules` (`effectSets`) |
| **count**: a count lost or wrong | A write cut short, or two at once | architecture: one store; unit: `store.test.ts`; journey: `counts` |
