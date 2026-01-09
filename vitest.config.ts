import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/*.test.ts",
        "**/index.ts",
      ],
      // Thresholds will be increased as more tests are added
      // Current focus: unit tests for core logic
      // TODO: Add integration tests with testcontainers for database
      thresholds: {
        statements: 15,
        branches: 60,
        functions: 40,
        lines: 15,
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
