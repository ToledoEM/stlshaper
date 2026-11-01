import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.js"],
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // Only the application's own source counts. The vendored libraries are
      // third-party, and _site/ is generated output.
      include: ["main.js", "worker.js"],
      // worker.js is at 100%. main.js sits just under it: the remainder is
      // error handlers and defensive fallbacks whose triggering conditions
      // cannot be reproduced without contriving fixtures that assert on the
      // mock rather than the code. The floors are set at the achieved figures
      // so a regression fails the build, and should be raised, never lowered.
      //
      // Re-baselined for vitest 5: its v8 coverage counts the implicit else of
      // every guard such as `if (el) { ... }`, which vitest 2 did not. On the
      // same source and tests, branches went from 93.77% to 88.47% while lines
      // rose. The lower statement and branch floors reflect that measurement
      // change, not lost coverage.
      thresholds: {
        lines: 98,
        functions: 98,
        branches: 89,
        statements: 97,
      },
    },
  },
});
