import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma";
import { validateReference, type Direction } from "../services/erpMock";

export const deliveriesRouter = Router();

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

deliveriesRouter.post("/", async (req, res) => {
  const input = parseDeliveryInput(req, res);
  if (!input) return;

  // Re-validate server-side rather than trusting the client's earlier
  // /validate-reference call — a request straight to this endpoint must not
  // be able to create a delivery with a reference that was never checked
  // against the ERP.
  const erpResult = await validateReference(input.direction, input.referenceNumber);
  if (!erpResult.valid) {
    return res.status(422).json({ error: "reference_number failed ERP validation" });
  }

  const delivery = await prisma.delivery.create({
    data: {
      direction: input.direction,
      referenceNumber: input.referenceNumber.trim().toUpperCase(),
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
