import { Router, type Request, type Response } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { storage } from "../lib/storage";
import { ALLOWED_IMAGE_TYPES_LABEL, detectImageType, extensionForImageType } from "../lib/imageTypes";
import { validateReference, type Direction } from "../services/erpMock";

export const deliveriesRouter = Router();

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const MAX_PHOTOS_PER_DELIVERY = 200;

// Bounded because memoryStorage buffers every part in RAM before any of our
// own validation runs — without limits one oversized POST can take the process
// down. A real size/resolution floor is still open (DESIGN.md §9); these are
// blast-radius caps, not quality rules.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS_PER_DELIVERY },
});

// Until there's real auth (Slice 6 / Keycloak in production, DESIGN.md §6).
const CURRENT_USER = "local-dev-user";

const MIN_PHOTOS_PER_PACKAGE = 4;

// storagePath is deliberately absent: it's the storage backend's internal
// layout, which the StorageClient exists to keep private. Clients address an
// image by id via /api/images/:id and never need to know where it lives.
const IMAGE_SELECT = {
  select: { id: true, phase: true, sequence: true, uploadedAt: true },
  orderBy: { sequence: "asc" },
} as const;

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
deliveriesRouter.post("/", upload.any(), async (req, res) => {
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
  // Sniffed from the bytes, never taken from the part's Content-Type header.
  const detectedTypes = new Map(files.map((file) => [file, detectImageType(file.buffer)]));
  if (files.some((file) => detectedTypes.get(file) == null)) {
    return res.status(400).json({
      error: `every photo must be an image file (${ALLOWED_IMAGE_TYPES_LABEL})`,
    });
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

  // Ids are generated up front so files can be written before the transaction
  // and still land under their final package's key. If the transaction then
  // fails, the already-written files are cleaned up below.
  const deliveryId = randomUUID();
  const written: { packageId: string; label: number; storagePaths: string[] }[] = [];

  try {
    for (const [label, packageFiles] of filesByLabel) {
      const packageId = randomUUID();
      const storagePaths = await Promise.all(
        packageFiles.map((file) =>
          storage.save(
            file.buffer,
            extensionForImageType(detectedTypes.get(file)!),
            `${deliveryId}/${packageId}`
          )
        )
      );
      written.push({ packageId, label, storagePaths });
    }

    const delivery = await prisma.delivery.create({
      data: {
        id: deliveryId,
        direction: input.direction,
        referenceNumber: input.referenceNumber.trim().toUpperCase(),
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
      include: { packages: { include: { images: IMAGE_SELECT } } },
    });

    res.status(201).json(delivery);
  } catch (error) {
    // Nothing references these files now, so leaving them would just be litter.
    await Promise.allSettled(
      written.flatMap(({ storagePaths }) => storagePaths.map((p) => storage.delete(p)))
    );
    throw error;
  }
});

deliveriesRouter.get("/", async (_req, res) => {
  const deliveries = await prisma.delivery.findMany({
    orderBy: { internalNumber: "desc" },
    include: { _count: { select: { packages: true } } },
  });

  res.json(
    deliveries.map(({ _count, ...delivery }) => ({
      ...delivery,
      packageCount: _count.packages,
    }))
  );
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
