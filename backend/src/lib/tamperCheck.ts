import type { Verdict } from "@prisma/client";

/**
 * One image as handed to the tamper-detection service.
 *
 * `storagePath` rather than bytes: whether the real API wants raw files, URLs
 * or base64 is still open (DESIGN.md §9), so the client implementation — not
 * its callers — decides how to turn a stored image into whatever the service
 * expects.
 */
export interface TamperCheckImage {
  id: string;
  storagePath: string;
  sequence: number;
}

/**
 * Two *sets*, deliberately not pre-paired: whether correspondence is
 * positional (front-before ↔ front-after) or something the service works out
 * itself is an open question (§9), so we hand over everything we have and let
 * the implementation decide.
 */
export interface TamperCheckInput {
  packageId: string;
  preShip: TamperCheckImage[];
  postReceive: TamperCheckImage[];
}

export interface TamperCheckResult {
  verdict: Verdict;
  /** Null unless the service exposes one; a score → verdict threshold would be ours to define (§3). */
  confidenceScore: number | null;
  /** Whatever the service returned, stored verbatim on the TamperCheck row. */
  raw: unknown;
}

/**
 * The seam the real third-party service will slot into. Nothing above this
 * interface knows how the check is performed — swapping the mock for the real
 * client should touch this file and nothing else.
 */
export interface TamperCheckClient {
  check(input: TamperCheckInput): Promise<TamperCheckResult>;
}

/** Thrown when the call itself fails, as distinct from returning a verdict. */
export class TamperCheckCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TamperCheckCallError";
  }
}

export type MockOutcome = Verdict | "CALL_FAILED";

// Same weighting as ui/index.html's runTamperCheck: mostly intact, with the
// occasional opened, inconclusive, and outright call failure.
const WEIGHTED_OUTCOMES: MockOutcome[] = [
  "INTACT",
  "INTACT",
  "INTACT",
  "INTACT",
  "OPENED",
  "INCONCLUSIVE",
  "CALL_FAILED",
];

const MOCK_OUTCOMES: MockOutcome[] = ["INTACT", "OPENED", "INCONCLUSIVE", "CALL_FAILED"];

let warnedAboutInvalidOutcome = false;

/**
 * A forced outcome from TAMPER_CHECK_OUTCOME, or null to draw at random.
 *
 * Random is right for exercising the app, but useless when you want to *show*
 * someone a specific state — you can't demo an opened package by uploading
 * photos and hoping for a 1-in-7 draw. Read per call so changing it doesn't
 * mean rebuilding anything.
 */
export function forcedOutcome(): MockOutcome | null {
  const configured = process.env.TAMPER_CHECK_OUTCOME?.trim().toUpperCase();
  if (!configured || configured === "RANDOM") return null;

  if ((MOCK_OUTCOMES as string[]).includes(configured)) {
    return configured as MockOutcome;
  }

  // Silently falling back to random would look exactly like a typo'd value
  // working, which is worse than the typo.
  if (!warnedAboutInvalidOutcome) {
    warnedAboutInvalidOutcome = true;
    console.warn(
      `Ignoring TAMPER_CHECK_OUTCOME="${process.env.TAMPER_CHECK_OUTCOME}" — expected one of ${MOCK_OUTCOMES.join(", ")}, or RANDOM. Falling back to random.`
    );
  }
  return null;
}

export function pickWeightedOutcome(): MockOutcome {
  return forcedOutcome() ?? WEIGHTED_OUTCOMES[Math.floor(Math.random() * WEIGHTED_OUTCOMES.length)];
}

/**
 * Stand-in for the real tamper-detection API, which we have no access to and
 * no contract for yet (DESIGN.md §9). It ignores the images entirely — it is
 * not detecting anything — and just reproduces the shape of the interaction:
 * a slow call that usually says "intact", sometimes flags a package, and
 * sometimes fails outright.
 *
 * Because it doesn't compare anything, uploading the *same* photos twice
 * proves nothing and can still come back "opened". Set TAMPER_CHECK_OUTCOME
 * to pin the result when you need a specific state (see forcedOutcome).
 *
 * Note it is not a "are these two images identical?" check, and shouldn't
 * become one: real pre-ship and post-receive photos are separate photographs
 * taken days apart, so they never match byte for byte. Equality would flag
 * every genuine package as opened.
 */
export class MockTamperCheckClient implements TamperCheckClient {
  constructor(
    private readonly pickOutcome: () => MockOutcome = pickWeightedOutcome,
    private readonly delayMs = 1800
  ) {}

  async check(input: TamperCheckInput): Promise<TamperCheckResult> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));

    const outcome = this.pickOutcome();
    if (outcome === "CALL_FAILED") {
      throw new TamperCheckCallError("tamper-detection service is unavailable");
    }

    return {
      verdict: outcome,
      confidenceScore: null,
      raw: {
        mock: true,
        verdict: outcome,
        comparedPreShip: input.preShip.length,
        comparedPostReceive: input.postReceive.length,
      },
    };
  }
}

// The client in use. Swapping this for the real service's implementation is
// the whole point of the interface above; tests swap it for a deterministic
// stub so they don't depend on a 1-in-7 outcome or wait 1.8s per check.
let activeClient: TamperCheckClient = new MockTamperCheckClient();

export function getTamperCheckClient(): TamperCheckClient {
  return activeClient;
}

export function setTamperCheckClient(client: TamperCheckClient): void {
  activeClient = client;
}
