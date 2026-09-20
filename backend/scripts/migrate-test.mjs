/**
 * Applies the migrations to the schema `.env.test` names.
 *
 * `prisma migrate dev` only ever reads `.env`, so a schema edit lands in the
 * development schema and leaves the suite's own schema a migration behind —
 * which surfaces as tests failing against columns that exist in the editor.
 * This is the second half of `npm run migrate`.
 *
 * It sets DATABASE_URL for a child process rather than for the shell. On
 * PowerShell there is no `VAR=value command` prefix, so the alternative is
 * `$env:DATABASE_URL = ...` and remembering to clear it afterwards; forgetting
 * leaves every later command in that session pointed at the test schema.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(backendDir, ".env.test");

// No file is the documented state on CI, which builds a database per run and
// has nothing to keep separate. Not an error, and not a reason to fail a
// `npm run migrate` that already did the half that matters.
if (!existsSync(envPath)) {
  console.log("No backend/.env.test — nothing to migrate. The suite will use .env.");
  process.exit(0);
}

const databaseUrl = parse(readFileSync(envPath)).DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("backend/.env.test has no DATABASE_URL. See .env.test.example.");
  process.exit(1);
}

// Whatever the local file says: `test` on a throwaway container, a schema of
// your own on a shared Postgres. Nothing here hardcodes a name.
let schema = "public";
try {
  schema = new URL(databaseUrl).searchParams.get("schema")?.trim() || "public";
} catch {
  console.error("backend/.env.test has a DATABASE_URL that is not a URL.");
  process.exit(1);
}

console.log(`Applying migrations to the "${schema}" schema.`);

// npx.cmd directly rather than through a shell: PowerShell's execution policy
// blocks the .ps1 shim, which is the same reason CONTRIBUTING.md says npm.cmd
// on the Windows workstation.
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npx, ["prisma", "migrate", "deploy"], {
  cwd: backendDir,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: databaseUrl },
});

if (result.error) {
  console.error(`Could not run ${npx}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
