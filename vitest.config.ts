import { defineConfig } from "vitest/config";

// Root config: only used when invoking `vitest` from the monorepo root.
// Per-package vitest runs use the package's own config.
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["**/node_modules/**", "**/dist/**", "**/tests/**"],
    },
  },
});
