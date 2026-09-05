import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      // Everything that ships, so a file with no test at all still shows up as
      // a zero rather than vanishing from the denominator.
      include: ["src/**"],
      exclude: [
        "src/**/*.test.ts",
        // Process bootstrap: reads env, opens a port, wires up shutdown. There
        // is no behavior here to assert that starting the server would not
        // already prove.
        "src/index.ts",
      ],
      reporter: ["text", "text-summary"],
    },
  },
});
