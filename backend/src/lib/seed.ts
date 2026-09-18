import { prisma } from "./prisma";
import { storage } from "./storage";
import { config } from "./config";
import { solidPng } from "./solidPng";
import { CURRENT_USER } from "./currentUser";
import { MIN_PHOTOS_PER_PACKAGE } from "./photoUpload";

/**
 * Development data, so a fresh clone opens on an application with something in
 * it instead of four empty screens.
 *
 * Every seeded delivery's reference number carries `SEED`, which is what makes
 * re-running this safe: it deletes exactly what it created and nothing a person
 * entered by hand. Rows cascade from the delivery, and the stored files are
 * removed first — the app itself still leaks those (P14), but a seed that ran
 * twenty times would leak twenty times over, which is a dev-machine problem
 * worth not having.
 */
export const SEED_MARK = "SEED";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Distinct enough that four photos of one package don't look like one photo. */
const PHOTO_COLOURS: [number, number, number][] = [
  [42, 63, 95],
  [90, 106, 133],
  [140, 152, 172],
  [196, 203, 214],
];

interface PackageSpec {
  label: number;
  workflowStatus: "SHIPPED" | "RECEIVED" | "CHECK_FAILED";
  verdict?: "INTACT" | "OPENED" | "INCONCLUSIVE";
  verdictSource?: "API" | "MANUAL";
  override?: { by: string; note: string };
  check?: { status: "COMPLETE" | "ERROR"; verdict?: "INTACT" | "OPENED" | "INCONCLUSIVE" };
}

interface DeliverySpec {
  reference: string;
  direction: "EXPORT" | "IMPORT";
  daysAgo: number;
  packages: PackageSpec[];
}

/**
 * One delivery per state a person might open the app to deal with, rather than
 * a volume of identical rows: nothing to do, everything fine, something opened,
 * a manager's correction, and a call that failed and is waiting for a human.
 */
const DELIVERIES: DeliverySpec[] = [
  {
    reference: `SHP-${SEED_MARK}001`,
    direction: "EXPORT",
    daysAgo: 1,
    packages: [
      { label: 1, workflowStatus: "SHIPPED" },
      { label: 2, workflowStatus: "SHIPPED" },
    ],
  },
  {
    reference: `PO-${SEED_MARK}002`,
    direction: "IMPORT",
    daysAgo: 4,
    packages: [
      {
        label: 1,
        workflowStatus: "RECEIVED",
        verdict: "INTACT",
        verdictSource: "API",
        check: { status: "COMPLETE", verdict: "INTACT" },
      },
    ],
  },
  {
    reference: `SHP-${SEED_MARK}003`,
    direction: "EXPORT",
    daysAgo: 6,
    packages: [
      {
        label: 1,
        workflowStatus: "RECEIVED",
        verdict: "OPENED",
        verdictSource: "API",
        check: { status: "COMPLETE", verdict: "OPENED" },
      },
      {
        label: 2,
        workflowStatus: "RECEIVED",
        verdict: "INTACT",
        verdictSource: "MANUAL",
        check: { status: "COMPLETE", verdict: "OPENED" },
        override: {
          by: "inventory-manager",
          note: "נבדק פיזית במחסן — הסרט קרוע בפינה אך התכולה מלאה ותואמת לתעודה.",
        },
      },
    ],
  },
  {
    reference: `PO-${SEED_MARK}004`,
    direction: "IMPORT",
    daysAgo: 9,
    packages: [{ label: 1, workflowStatus: "CHECK_FAILED", check: { status: "ERROR" } }],
  },
  // The inconclusive case, both halves: one waiting for a manager, one a
  // manager has been through. It is §2's whole reason for the role, and it has
  // its own stat card, filter and priority rung — all of which read as empty
  // until something lands in them.
  {
    reference: `SHP-${SEED_MARK}005`,
    direction: "EXPORT",
    daysAgo: 3,
    packages: [
      {
        label: 1,
        workflowStatus: "RECEIVED",
        verdict: "INCONCLUSIVE",
        verdictSource: "API",
        check: { status: "COMPLETE", verdict: "INCONCLUSIVE" },
      },
      {
        // A manager resolves to INTACT or OPENED — never back to INCONCLUSIVE
        // (ManagerReviewPanel). This is what an inconclusive package looks like
        // afterwards, and the only row whose override agrees with a suspicion
        // rather than overturning it.
        label: 2,
        workflowStatus: "RECEIVED",
        verdict: "OPENED",
        verdictSource: "MANUAL",
        check: { status: "COMPLETE", verdict: "INCONCLUSIVE" },
        override: {
          by: "inventory-manager",
          note: "הצילומים לא איפשרו הכרעה. בבדיקה פיזית במחסן נמצא שסרט האריזה הוחלף וחסר פריט אחד מול תעודת המשלוח.",
        },
      },
    ],
  },
];

export interface SeedResult {
  deliveries: number;
  packages: number;
  images: number;
}

/**
 * `isProduction` is a parameter rather than a straight read of `config` so the
 * refusal can be tested; nothing passes it in real use.
 */
export async function seedDatabase(isProduction = config.isProduction): Promise<SeedResult> {
  if (isProduction) {
    throw new Error("Refusing to seed: NODE_ENV is production");
  }

  await clearPreviousSeed();

  let packages = 0;
  let images = 0;

  for (const spec of DELIVERIES) {
    const createdAt = new Date(Date.now() - spec.daysAgo * DAY_MS);

    const delivery = await prisma.delivery.create({
      data: {
        direction: spec.direction,
        referenceNumber: spec.reference,
        createdBy: CURRENT_USER,
        createdAt,
      },
    });

    for (const packageSpec of spec.packages) {
      const pkg = await prisma.package.create({
        data: {
          deliveryId: delivery.id,
          label: packageSpec.label,
          workflowStatus: packageSpec.workflowStatus,
          verdict: packageSpec.verdict,
          verdictSource: packageSpec.verdictSource,
          verdictOverriddenBy: packageSpec.override?.by,
          overrideNote: packageSpec.override?.note,
          overriddenAt: packageSpec.override ? new Date(createdAt.getTime() + DAY_MS) : undefined,
        },
      });
      packages++;

      // A package past SHIPPED has been photographed at both ends; one still in
      // transit has only its pre-ship set.
      const phases =
        packageSpec.workflowStatus === "SHIPPED"
          ? (["PRE_SHIP"] as const)
          : (["PRE_SHIP", "POST_RECEIVE"] as const);

      for (const phase of phases) {
        images += await createPhotos(delivery.id, pkg.id, phase, createdAt);
      }

      if (packageSpec.check) {
        await prisma.tamperCheck.create({
          data: {
            packageId: pkg.id,
            status: packageSpec.check.status,
            verdict: packageSpec.check.verdict,
            requestedAt: new Date(createdAt.getTime() + DAY_MS),
            completedAt: new Date(createdAt.getTime() + DAY_MS + 4000),
            rawResponse: { seeded: true, note: "development data, never came from a vendor" },
          },
        });
      }
    }
  }

  return { deliveries: DELIVERIES.length, packages, images };
}

async function createPhotos(
  deliveryId: string,
  packageId: string,
  phase: "PRE_SHIP" | "POST_RECEIVE",
  takenAt: Date
): Promise<number> {
  for (let sequence = 0; sequence < MIN_PHOTOS_PER_PACKAGE; sequence++) {
    const bytes = solidPng(160, 160, PHOTO_COLOURS[sequence % PHOTO_COLOURS.length]);
    // The same key prefix the upload routes use, so seeded files sit where real
    // ones would rather than in a directory only the seed knows about.
    const storagePath = await storage.save(bytes, ".png", `${deliveryId}/${packageId}`);

    await prisma.packageImage.create({
      data: {
        packageId,
        phase,
        storagePath,
        sequence,
        uploadedBy: CURRENT_USER,
        uploadedAt: phase === "PRE_SHIP" ? takenAt : new Date(takenAt.getTime() + DAY_MS),
      },
    });
  }
  return MIN_PHOTOS_PER_PACKAGE;
}

async function clearPreviousSeed(): Promise<void> {
  const previous = await prisma.delivery.findMany({
    where: { referenceNumber: { contains: SEED_MARK } },
    select: { packages: { select: { images: { select: { storagePath: true } } } } },
  });

  for (const delivery of previous) {
    for (const pkg of delivery.packages) {
      for (const image of pkg.images) {
        // Best effort: a file already gone is the state we want anyway.
        await storage.delete(image.storagePath).catch(() => {});
      }
    }
  }

  await prisma.delivery.deleteMany({ where: { referenceNumber: { contains: SEED_MARK } } });
}
