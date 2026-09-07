import { randomUUID } from "crypto";

/**
 * This process, for as long as it lives.
 *
 * A tamper check is leased to whichever process is running it
 * (`services/tamperCheckService.ts`), and "whichever process" needs a name that
 * two instances cannot share. Minted rather than read from the environment: the
 * platform's own instance id would be better in a log search, but nothing
 * guarantees one exists, and correctness here only needs uniqueness.
 */
export const INSTANCE_ID = randomUUID();
