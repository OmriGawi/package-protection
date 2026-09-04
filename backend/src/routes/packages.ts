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

export const packagesRouter = Router();

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
