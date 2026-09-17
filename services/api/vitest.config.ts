import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Vite's built-in Node-builtin externalization list predates
    // `node:sqlite`, so it tries to bundle it as if it were an npm
    // package. Force it (and anything else under node:) to stay external.
    server: {
      deps: {
        external: [/^node:/],
      },
    },
  },
});
