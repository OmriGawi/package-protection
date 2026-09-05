import { Router, type Request } from "express";
import { prisma } from "../lib/prisma";
import {
  IMAGE_SELECT,
  MIN_PHOTOS_PER_PACKAGE,
  PHOTO_TYPE_ERROR,
  detectPhotoTypes,
  savePhotos,
  upload,
} from "../lib/photoUpload";
import { storage } from "../lib/storage";
import { CURRENT_USER } from "../lib/currentUser";
import { claimForCheck, releaseClaim, startCheck } from "../services/tamperCheckService";
import {
  PACKAGE_FILTERS,
  findPackagePage,
  isPackageFilter,
  type PackageFilterKey,
} from "../services/packageQuery";

export const packagesRouter = Router();

/**
 * The Inventory Manager's dashboard (DESIGN.md §4.4): every package across
 * every delivery, most urgent first, with an operation-wide overview alongside
 * the page.
 *
 * Registered before "/:id/..." routes below, though it cannot collide with
 * them — "/" is not a package id.
 */
packagesRouter.get("/", async (req, res) => {
  const { search, filter, page } = req.query as {
    search?: unknown;
    filter?: unknown;
    page?: unknown;
  };

  // Express 5 turns a repeated ?search=a&search=b into an array; calling
  // .trim() on it would 500 rather than answer.
  for (const [name, value] of Object.entries({ search, filter, page })) {
    if (value !== undefined && typeof value !== "string") {
      return res.status(400).json({ error: `${name} must be given at most once` });
    }
  }

  // Rejected rather than coerced: silently serving everything for a typo'd
  // filter looks exactly like a filter that matched nothing.
  if (filter !== undefined && !isPackageFilter(filter as string)) {
    return res.status(400).json({
      error: `filter must be one of ${PACKAGE_FILTERS.join(", ")}`,
    });
  }

  const pageNumber = page === undefined ? 1 : Number(page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return res.status(400).json({ error: "page must be a positive integer" });
  }

  const result = await findPackagePage({
    search: (search as string | undefined)?.trim() || undefined,
    filter: filter as PackageFilterKey | undefined,
    page: pageNumber,
  });

  res.json(result);
});

function packageWithImages(id: string) {
  return prisma.package.findUnique({
    where: { id },
    include: { images: IMAGE_SELECT },
  });
}

/**
 * Receiving (DESIGN.md §4.2): the post-receive photos are stored, then the
 * tamper-detection call is started but not awaited — this returns 202 with the
 * package in CHECKING and the client polls for the outcome.
 */
// Params are typed explicitly because Express 5 widens req.params values to
// `string | string[]` (a route can repeat a param), which a route with
// middleware in front of it doesn't narrow from the path on its own.
packagesRouter.post("/:id/post-receive-photos", upload.any(), async (req: Request<{ id: string }>, res) => {
  const pkg = await prisma.package.findUnique({ where: { id: req.params.id } });
  if (!pkg) return res.status(404).json({ error: "package not found" });

  if (pkg.workflowStatus !== "SHIPPED") {
    return res.status(409).json({
      error: "post-receive photos can only be uploaded for a shipped package",
    });
  }

  const files = (req.files as Express.Multer.File[]) ?? [];
  if (files.length < MIN_PHOTOS_PER_PACKAGE) {
    return res.status(400).json({
      error: `a package needs at least ${MIN_PHOTOS_PER_PACKAGE} post-receive photos`,
    });
  }

  const detectedTypes = detectPhotoTypes(files);
  if (!detectedTypes) {
    return res.status(400).json({ error: PHOTO_TYPE_ERROR });
  }

  // Claimed before anything is written, so two simultaneous uploads can't both
  // attach photos and race to produce a verdict — the check above only gives a
  // clearer error message, this is what actually decides.
  if (!(await claimForCheck(pkg.id, ["SHIPPED"]))) {
    return res.status(409).json({ error: "this package is already being received" });
  }

  let storagePaths: string[] = [];
  try {
    storagePaths = await savePhotos(files, detectedTypes, `${pkg.deliveryId}/${pkg.id}`);

    await prisma.packageImage.createMany({
      data: storagePaths.map((storagePath, index) => ({
        packageId: pkg.id,
        phase: "POST_RECEIVE" as const,
        storagePath,
        uploadedBy: CURRENT_USER,
        sequence: index + 1,
      })),
    });

    await startCheck(pkg.id);
  } catch (error) {
    // Hand the package back so the employee can simply try again, instead of
    // leaving it stuck in CHECKING with half its photos attached.
    await releaseClaim(pkg.id, "SHIPPED");
    await prisma.packageImage.deleteMany({ where: { packageId: pkg.id, storagePath: { in: storagePaths } } });
    await Promise.allSettled(storagePaths.map((path) => storage.delete(path)));
    throw error;
  }

  res.status(202).json(await packageWithImages(pkg.id));
});

/**
 * The Inventory Manager's verdict override (DESIGN.md §4.4.5).
 *
 * Two outcomes, not one: INCONCLUSIVE exists precisely because the algorithm
 * could not decide, so a physical check has to be able to resolve it either
 * way. An earlier wireframe offered only "confirm intact", which silently
 * assumed every override is a false positive being corrected.
 *
 * The note is required. It is the only record of what the physical check
 * actually found, and it outlives everyone who remembers the package.
 */
packagesRouter.post("/:id/review", async (req: Request<{ id: string }>, res) => {
  const { verdict, note } = req.body as { verdict?: unknown; note?: unknown };

  if (verdict !== "INTACT" && verdict !== "OPENED") {
    return res.status(400).json({ error: "verdict must be INTACT or OPENED" });
  }

  const trimmedNote = typeof note === "string" ? note.trim() : "";
  if (!trimmedNote) {
    return res.status(400).json({ error: "note is required" });
  }

  const pkg = await prisma.package.findUnique({ where: { id: req.params.id } });
  if (!pkg) return res.status(404).json({ error: "package not found" });

  // The same rule the dashboard sorts and labels by (packageQuery's
  // NEEDS_REVIEW): a verdict a human can still change. A failed call has none
  // to override — retrying is what that state offers (§4.2) — a package in
  // transit was never checked, and an INTACT result is already resolved
  // (§4.4.3). The three must agree, or a package the dashboard never offers
  // for review is still reviewable through a hand-made request.
  const reviewable =
    pkg.workflowStatus === "RECEIVED" &&
    (pkg.verdict === "OPENED" || pkg.verdict === "INCONCLUSIVE") &&
    pkg.verdictSource !== "MANUAL";

  if (!reviewable) {
    return res.status(409).json({ error: "this package has no verdict to review" });
  }

  // Guarded in the UPDATE itself, not just by the read above: two managers
  // submitting at once would otherwise both pass the check and the second
  // would overwrite the first's note — destroying the only record of what that
  // physical check found.
  const { count } = await prisma.package.updateMany({
    where: { id: pkg.id, verdictSource: { not: "MANUAL" } },
    data: {
      verdict,
      verdictSource: "MANUAL",
      verdictOverriddenBy: CURRENT_USER,
      overriddenAt: new Date(),
      overrideNote: trimmedNote,
    },
  });

  if (count === 0) {
    return res.status(409).json({ error: "this package has already been reviewed" });
  }

  res.json(await packageWithImages(pkg.id));
});

/**
 * Retry after a failed call. The photos are already stored, so this re-runs
 * the same check rather than asking for them again (§4.2).
 */
packagesRouter.post("/:id/tamper-check", async (req, res) => {
  const pkg = await prisma.package.findUnique({ where: { id: req.params.id } });
  if (!pkg) return res.status(404).json({ error: "package not found" });

  if (pkg.workflowStatus !== "CHECK_FAILED") {
    return res.status(409).json({ error: "only a failed check can be retried" });
  }

  if (!(await claimForCheck(pkg.id, ["CHECK_FAILED"]))) {
    return res.status(409).json({ error: "this package is already being checked" });
  }

  try {
    await startCheck(pkg.id);
  } catch (error) {
    await releaseClaim(pkg.id, "CHECK_FAILED");
    throw error;
  }

  res.status(202).json(await packageWithImages(pkg.id));
});
