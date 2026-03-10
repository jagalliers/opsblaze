import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["**/__tests__/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["server/**/*.ts", "mcp-server/**/*.ts", "src/**/*.{ts,tsx}"],
      exclude: [
        "**/__tests__/**",
        "dist/**",
        "*.config.*",
        "server/logger.ts",
        "mcp-server/logger.ts",
      ],
    },
  },
});
