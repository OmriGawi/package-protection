import { existsSync, readFileSync } from "fs";
import path from "path";
import { parse } from "dotenv";
import { defineConfig } from "vitest/config";

/**
 * `.env.test`, if there is one, wins over `.env` for the suite.
 *
 * The tests write to whatever `DATABASE_URL` names, and `src/lib/config.ts`
 * loads `.env` — so on a machine where the only Postgres is a shared one (no
 * Docker on the company laptops), running the suite would otherwise mean
 * running it against the same database being used for development. This makes
 * the separation a file rather than a habit.
 *
 * Absent — CI, and anyone with a throwaway local Postgres — nothing changes:
 * `test.env` stays empty and `DATABASE_URL` comes from the environment or
 * `.env` as before. Parsed rather than loaded, so this config file doesn't
 * mutate its own process's environment as a side effect.
 */
const testEnvPath = path.resolve(__dirname, ".env.test");
const testEnv = existsSync(testEnvPath) ? parse(readFileSync(testEnvPath)) : {};

export default defineConfig({
  test: {
    env: testEnv,
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
