import { Router } from "express";
import { prisma } from "../lib/prisma";
import { validateReference, type Direction } from "../services/erpMock";

export const deliveriesRouter = Router();

deliveriesRouter.post("/validate-reference", async (req, res) => {
  const { direction, reference_number } = req.body as {
    direction?: Direction;
    reference_number?: string;
  };

  if (direction !== "EXPORT" && direction !== "IMPORT") {
    return res.status(400).json({ error: "direction must be EXPORT or IMPORT" });
  }
  if (!reference_number || !reference_number.trim()) {
    return res.status(400).json({ error: "reference_number is required" });
  }

  const result = await validateReference(direction, reference_number);
  res.json({ valid: result.valid, linked_po_number: result.linkedPoNumber });
});

deliveriesRouter.post("/", async (req, res) => {
  const { direction, reference_number } = req.body as {
    direction?: Direction;
    reference_number?: string;
  };

  if (direction !== "EXPORT" && direction !== "IMPORT") {
    return res.status(400).json({ error: "direction must be EXPORT or IMPORT" });
  }
  if (!reference_number || !reference_number.trim()) {
    return res.status(400).json({ error: "reference_number is required" });
  }

  const delivery = await prisma.delivery.create({
    data: {
      direction,
      referenceNumber: reference_number.trim().toUpperCase(),
      createdBy: "local-dev-user",
    },
  });

  res.status(201).json(delivery);
});

deliveriesRouter.get("/", async (_req, res) => {
  const deliveries = await prisma.delivery.findMany({
    orderBy: { internalNumber: "desc" },
  });
  res.json(deliveries);
});
