const API_URL = import.meta.env.VITE_API_URL as string;

export type Direction = "EXPORT" | "IMPORT";

export interface Delivery {
  id: string;
  internalNumber: number;
  direction: Direction;
  referenceNumber: string;
  status: "SUBMITTED";
  createdBy: string;
  createdAt: string;
}

export interface ValidateReferenceResult {
  valid: boolean;
  linked_po_number?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function validateReference(direction: Direction, referenceNumber: string) {
  return request<ValidateReferenceResult>("/api/deliveries/validate-reference", {
    method: "POST",
    body: JSON.stringify({ direction, reference_number: referenceNumber }),
  });
}

export function createDelivery(direction: Direction, referenceNumber: string) {
  return request<Delivery>("/api/deliveries", {
    method: "POST",
    body: JSON.stringify({ direction, reference_number: referenceNumber }),
  });
}

export function listDeliveries() {
  return request<Delivery[]>("/api/deliveries");
}
