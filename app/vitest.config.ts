import { defineConfig } from "vitest/config";

/**
 * Vitest runs ONLY the pure TS logic modules (src/lib/**). Everything that
 * touches React Native / Expo native modules is exercised on-device.
 */
export default defineConfig({
  test: {
    include: ["src/lib/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
