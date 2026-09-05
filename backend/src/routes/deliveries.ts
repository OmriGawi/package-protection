import { Router, type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { storage } from "../lib/storage";
import {
  IMAGE_SELECT,
  MIN_PHOTOS_PER_PACKAGE,
  PHOTO_TYPE_ERROR,
  detectPhotoTypes,
  savePhotos,
  upload,
} from "../lib/photoUpload";
import { CURRENT_USER } from "../lib/currentUser";
import { IDEMPOTENCY_KEY_ERROR, readIdempotencyKey } from "../lib/idempotency";
import { log } from "../lib/logger";
import { uploadLimiter } from "../middleware/rateLimit";
import { limitUploadBytes } from "../middleware/uploadSize";
import { validateReference, type Direction } from "../services/erpMock";
import {
  DELIVERY_STATUSES,
  findDeliveryPage,
  isDeliveryStatus,
  type DeliveryStatusKey,
} from "../services/deliveryQuery";

export const deliveriesRouter = Router();

interface PackageInput {
  label: number;
}

function parseDeliveryInput(
  req: Request,
  res: Response
): { direction: Direction; referenceNumber: string } | null {
  const { direction, reference_number } = req.body as {
    direction?: Direction;
    reference_number?: string;
  };

  if (direction !== "EXPORT" && direction !== "IMPORT") {
    res.status(400).json({ error: "direction must be EXPORT or IMPORT" });
    return null;
  }
  if (!reference_number || !reference_number.trim()) {
    res.status(400).json({ error: "reference_number is required" });
    return null;
  }

  return { direction, referenceNumber: reference_number };
}

deliveriesRouter.post("/validate-reference", async (req, res) => {
  const input = parseDeliveryInput(req, res);
  if (!input) return;

  const result = await validateReference(input.direction, input.referenceNumber);
  res.json({ valid: result.valid, linked_po_number: result.linkedPoNumber });
});

// A delivery and all of its packages arrive together in one multipart request:
// nothing is persisted before Submit (DESIGN.md §3), so the photos are still
// in-session File objects on the client until this call.
/**
 * Checked before multer runs, not after: a malformed key is decidable from the
 * headers alone, and rejecting it later means the caller has already uploaded
 * 150MB to be told its header was wrong.
 */
function validateIdempotencyHeader(req: Request, res: Response, next: NextFunction): void {
  if (!readIdempotencyKey(req).ok) {
    res.status(400).json({ error: IDEMPOTENCY_KEY_ERROR });
    return;
  }
  next();
}

deliveriesRouter.post("/", uploadLimiter, limitUploadBytes, validateIdempotencyHeader, upload.any(), async (req, res) => {
  const idempotency = readIdempotencyKey(req);
  if (!idempotency.ok) {
    return res.status(400).json({ error: IDEMPOTENCY_KEY_ERROR });
  }

  const input = parseDeliveryInput(req, res);
  if (!input) return;

  const erpResult = await validateReference(input.direction, input.referenceNumber);
  if (!erpResult.valid) {
    return res.status(422).json({ error: "reference_number failed ERP validation" });
  }

  let packageInputs: PackageInput[];
  try {
    packageInputs = JSON.parse((req.body as { packages?: string }).packages ?? "");
  } catch {
    return res.status(400).json({ error: "packages must be valid JSON" });
  }

  if (!Array.isArray(packageInputs) || packageInputs.length === 0) {
    return res.status(400).json({ error: "a delivery needs at least one package" });
  }

  if (packageInputs.some((pkg) => !pkg || typeof pkg !== "object")) {
    return res.status(400).json({ error: "every package must be an object with a label" });
  }
  const labels = packageInputs.map((p) => p.label);
  if (labels.some((label) => !Number.isInteger(label) || label < 1)) {
    return res.status(400).json({ error: "every package needs a positive integer label" });
  }
  if (new Set(labels).size !== labels.length) {
    return res.status(400).json({ error: "package labels must be unique within a delivery" });
  }

  const files = (req.files as Express.Multer.File[]) ?? [];
  const detectedTypes = detectPhotoTypes(files);
  if (!detectedTypes) {
    return res.status(400).json({ error: PHOTO_TYPE_ERROR });
  }

  const filesByLabel = new Map<number, Express.Multer.File[]>();
  for (const label of labels) {
    filesByLabel.set(
      label,
      files.filter((file) => file.fieldname === `package_${label}`)
    );
  }
  for (const [label, packageFiles] of filesByLabel) {
    if (packageFiles.length < MIN_PHOTOS_PER_PACKAGE) {
      return res.status(400).json({
        error: `package ${label} needs at least ${MIN_PHOTOS_PER_PACKAGE} photos`,
      });
    }
  }

  // Before a byte is written: a retry after a timeout is asking for the delivery
  // it already created, not for a second one (docs/production-readiness.md P8).
  if (idempotency.key) {
    const existing = await findByIdempotencyKey(idempotency.key);
    if (existing) {
      if (!describesSameDelivery(existing, input, filesByLabel)) {
        log.warn("delivery_create_key_reused", { deliveryId: existing.id });
        return res.status(409).json({
          error: "this idempotency-key already created a different delivery",
          delivery_id: existing.id,
        });
      }

      log.info("delivery_create_replayed", { deliveryId: existing.id });
      return res.status(200).json(existing);
    }
  }

  // Ids are generated up front so files can be written before the transaction
  // and still land under their final package's key. If the transaction then
  // fails, the already-written files are cleaned up below.
  const deliveryId = randomUUID();
  const written: { packageId: string; label: number; storagePaths: string[] }[] = [];

  try {
    for (const [label, packageFiles] of filesByLabel) {
      const packageId = randomUUID();
      const storagePaths = await savePhotos(packageFiles, detectedTypes, `${deliveryId}/${packageId}`);
      written.push({ packageId, label, storagePaths });
    }

    const delivery = await prisma.delivery.create({
      data: {
        id: deliveryId,
        direction: input.direction,
        referenceNumber: input.referenceNumber.trim().toUpperCase(),
        idempotencyKey: idempotency.key,
        createdBy: CURRENT_USER,
        packages: {
          create: written.map(({ packageId, label, storagePaths }) => ({
            id: packageId,
            label,
            workflowStatus: "SHIPPED" as const,
            images: {
              create: storagePaths.map((storagePath, index) => ({
                phase: "PRE_SHIP" as const,
                storagePath,
                uploadedBy: CURRENT_USER,
                sequence: index + 1,
              })),
            },
          })),
        },
      },
      include: DELIVERY_WITH_PACKAGES,
    });

    res.status(201).json(delivery);
  } catch (error) {
    // Nothing references these files now, so leaving them would just be litter.
    await Promise.allSettled(
      written.flatMap(({ storagePaths }) => storagePaths.map((p) => storage.delete(p)))
    );

    // Two identical submits in flight at once: the lookup above found nothing
    // for either, and the database decided which one wins. The loser answers
    // with the winner's delivery rather than an error — from the caller's side
    // this is the same retry the lookup handles, it just arrived sooner.
    if (idempotency.key && isUniqueViolationOn(error, "idempotencyKey")) {
      const existing = await findByIdempotencyKey(idempotency.key);
      if (existing && describesSameDelivery(existing, input, filesByLabel)) {
        log.info("delivery_create_replayed", { deliveryId: existing.id, raced: true });
        return res.status(200).json(existing);
      }
    }

    throw error;
  }
});

/** One shape for a delivery-with-packages, so a 201 and a replayed 200 agree on order. */
const DELIVERY_WITH_PACKAGES = {
  packages: { orderBy: { label: "asc" }, include: { images: IMAGE_SELECT } },
} as const;

function findByIdempotencyKey(idempotencyKey: string) {
  return prisma.delivery.findUnique({
    where: { idempotencyKey },
    include: DELIVERY_WITH_PACKAGES,
  });
}

type StoredDelivery = NonNullable<Awaited<ReturnType<typeof findByIdempotencyKey>>>;

/**
 * Whether a replay is asking for the delivery it originally sent.
 *
 * A key is deliberately kept across retries, which means it can outlive the
 * draft it was minted for: the submit commits, the response is lost, and the
 * employee adds the package they forgot before pressing send again. Replaying
 * blindly would answer 200, navigate to the confirmation, and drop that package
 * without a word. Nothing extra is stored to detect it — the delivery itself
 * already records everything the request described.
 */
function describesSameDelivery(
  stored: StoredDelivery,
  input: { direction: Direction; referenceNumber: string },
  filesByLabel: Map<number, Express.Multer.File[]>
): boolean {
  if (stored.direction !== input.direction) return false;
  if (stored.referenceNumber !== input.referenceNumber.trim().toUpperCase()) return false;
  if (stored.packages.length !== filesByLabel.size) return false;

  return stored.packages.every((pkg) => {
    const photos = filesByLabel.get(pkg.label);
    return photos !== undefined && photos.length === pkg.images.length;
  });
}

/** Prisma's unique-constraint error, when it names the field we care about. */
function isUniqueViolationOn(error: unknown, field: string): boolean {
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate?.code !== "P2002") return false;

  const target = candidate.meta?.target;
  return Array.isArray(target) ? target.includes(field) : target === field;
}

deliveriesRouter.get("/", async (req, res) => {
  const { search, status, page } = req.query as {
    search?: unknown;
    status?: unknown;
    page?: unknown;
  };

  // Express 5 turns a repeated ?search=a&search=b into an array; calling
  // .trim() on it would 500 rather than answer.
  for (const [name, value] of Object.entries({ search, status, page })) {
    if (value !== undefined && typeof value !== "string") {
      return res.status(400).json({ error: `${name} must be given at most once` });
    }
  }

  // Rejected rather than coerced: silently serving page 1 of everything for a
  // typo'd filter looks exactly like a filter that matched nothing.
  if (status !== undefined && !isDeliveryStatus(status as string)) {
    return res.status(400).json({
      error: `status must be one of ${DELIVERY_STATUSES.join(", ")}`,
    });
  }

  const pageNumber = page === undefined ? 1 : Number(page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return res.status(400).json({ error: "page must be a positive integer" });
  }

  const result = await findDeliveryPage({
    search: (search as string | undefined)?.trim() || undefined,
    status: status as DeliveryStatusKey | undefined,
    page: pageNumber,
  });

  res.json(result);
});

deliveriesRouter.get("/:id", async (req, res) => {
  const delivery = await prisma.delivery.findUnique({
    where: { id: req.params.id },
    include: {
      packages: {
        orderBy: { label: "asc" },
        include: { images: IMAGE_SELECT },
      },
    },
  });

  if (!delivery) return res.status(404).json({ error: "delivery not found" });
  res.json(delivery);
});
