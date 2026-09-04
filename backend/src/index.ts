import "dotenv/config";
import { app } from "./app";
import { recoverInterruptedChecks } from "./services/tamperCheckService";

const port = Number(process.env.PORT) || 4000;

async function start() {
  // A check runs in this process, so a restart strands anything mid-flight in
  // CHECKING. Recovery is best-effort though: if the database isn't up yet,
  // that's a reason to log and still serve, not to refuse to start.
  try {
    const recovered = await recoverInterruptedChecks();
    if (recovered > 0) {
      console.log(`Recovered ${recovered} package(s) left mid-check by a restart`);
    }
  } catch (error) {
    console.error("Could not recover interrupted checks at startup", error);
  }

  app.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start the backend", error);
  process.exit(1);
});
