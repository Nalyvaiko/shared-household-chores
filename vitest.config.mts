import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.{test,spec}.{ts,tsx}"],
    // e2e/ holds the Playwright specs; `npm run test:e2e` runs them.
    exclude: ["node_modules", ".next", "out", "build", "e2e/**"],
  },
});
