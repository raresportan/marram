# Tally feature map

Everything Tally does, how a user reaches it, and what verifies it.

- **Counting.** Click the button; the count goes up, and it's still there after a restart.
  - ✅ counts › "It starts at zero"
  - ✅ counts › "One click counts one"
  - ✅ counts › "The count survives a restart"
- **A damaged count.** A count file that's missing or damaged counts as zero rather than stopping the app.
  - ❌ only the store's unit test covers this; no journey starts the app on a damaged file.
- **A window that fits.** Every control can be clicked where it's drawn.
  - ✅ layout
