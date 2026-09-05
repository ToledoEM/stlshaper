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
      thresholds: {
        lines: 98,
        functions: 98,
        branches: 92,
        statements: 98,
      },
    },
  },
});
