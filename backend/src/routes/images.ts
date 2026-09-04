import { Router } from "express";
import path from "path";
import { prisma } from "../lib/prisma";
import { storage } from "../lib/storage";
import { contentTypeForExtension } from "../lib/imageTypes";

export const imagesRouter = Router();

// Images are served through the StorageClient rather than a static directory,
// so production can swap in the internal storage service (DESIGN.md §7)
// without the URL the frontend uses changing at all.
imagesRouter.get("/:id", async (req, res) => {
  const image = await prisma.packageImage.findUnique({ where: { id: req.params.id } });
  if (!image) return res.status(404).json({ error: "image not found" });

  let bytes: Buffer;
  try {
    bytes = await storage.read(image.storagePath);
  } catch {
    return res.status(404).json({ error: "image file is missing from storage" });
  }

  res.type(contentTypeForExtension(path.extname(image.storagePath)));
  res.send(bytes);
});
