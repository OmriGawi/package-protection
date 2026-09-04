const API_URL = import.meta.env.VITE_API_URL as string;

export type Direction = "EXPORT" | "IMPORT";
export type WorkflowStatus = "PRE_SHIP_UPLOADED" | "SHIPPED" | "CHECKING" | "RECEIVED" | "CHECK_FAILED";
export type Verdict = "INTACT" | "OPENED" | "INCONCLUSIVE";
export type Phase = "PRE_SHIP" | "POST_RECEIVE";

export interface PackageImage {
  id: string;
  phase: Phase;
  sequence: number;
}

export interface Package {
  id: string;
  label: number;
  workflowStatus: WorkflowStatus;
  verdict: Verdict | null;
  verdictSource: "API" | "MANUAL" | null;
  images: PackageImage[];
}

export interface Delivery {
  id: string;
  internalNumber: number;
  direction: Direction;
  referenceNumber: string;
  status: "SUBMITTED";
  createdBy: string;
  createdAt: string;
}

export interface DeliveryListItem extends Delivery {
  packageCount: number;
}

export interface DeliveryDetail extends Delivery {
  packages: Package[];
}

export interface ValidateReferenceResult {
  valid: boolean;
  linked_po_number?: string;
}

/** A package as assembled in the create-delivery flow, before it's submitted. */
export interface DraftPackage {
  id: string;
  label: number;
  photos: File[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function validateReference(direction: Direction, referenceNumber: string) {
  return request<ValidateReferenceResult>("/api/deliveries/validate-reference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ direction, reference_number: referenceNumber }),
  });
}

/**
 * The whole delivery goes up in one request — nothing is persisted before
 * Submit (DESIGN.md §3), so this is the first time the photos leave the browser.
 */
export function createDelivery(direction: Direction, referenceNumber: string, packages: DraftPackage[]) {
  const form = new FormData();
  form.append("direction", direction);
  form.append("reference_number", referenceNumber);
  form.append("packages", JSON.stringify(packages.map((p) => ({ label: p.label }))));

  for (const pkg of packages) {
    for (const photo of pkg.photos) {
      form.append(`package_${pkg.label}`, photo, photo.name);
    }
  }

  // No Content-Type header: the browser sets it with the multipart boundary.
  return request<DeliveryDetail>("/api/deliveries", { method: "POST", body: form });
}

export function listDeliveries() {
  return request<DeliveryListItem[]>("/api/deliveries");
}

export function getDelivery(id: string) {
  return request<DeliveryDetail>(`/api/deliveries/${id}`);
}

export function imageUrl(imageId: string) {
  return `${API_URL}/api/images/${imageId}`;
}

/**
 * Uploads the receiving photos and starts the tamper check. Returns with the
 * package in CHECKING — the verdict arrives later, via polling (DESIGN.md §4.2).
 */
export function submitPostReceivePhotos(packageId: string, photos: File[]) {
  const form = new FormData();
  for (const photo of photos) form.append("photos", photo, photo.name);

  return request<Package>(`/api/packages/${packageId}/post-receive-photos`, {
    method: "POST",
    body: form,
  });
}

/** Re-runs a failed check against the already-uploaded photos — no re-upload. */
export function retryTamperCheck(packageId: string) {
  return request<Package>(`/api/packages/${packageId}/tamper-check`, { method: "POST" });
}
