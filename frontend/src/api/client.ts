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
  // Set once a manager has reviewed the package (DESIGN.md §4.4.5). The note
  // is the only record of what the physical check found, so it stays on screen
  // permanently afterwards rather than being a transient confirmation.
  verdictOverriddenBy: string | null;
  overriddenAt: string | null;
  overrideNote: string | null;
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

export type DeliveryStatusKey =
  | "OPENED"
  | "CHECK_FAILED"
  | "INCONCLUSIVE"
  | "AWAITING_RECEIPT"
  | "COMPLETE";

/**
 * A row of the deliveries list. Deliberately not `extends Delivery`: the list
 * endpoint doesn't return the persisted `status` (always SUBMITTED), and
 * `attentionStatus` is a different thing entirely — derived from the packages,
 * it's the most urgent true thing about the delivery (DESIGN.md §4.3).
 */
export interface DeliveryListItem {
  id: string;
  internalNumber: number;
  direction: Direction;
  referenceNumber: string;
  createdAt: string;
  packageCount: number;
  attentionStatus: DeliveryStatusKey;
}

export interface DeliveryPage {
  items: DeliveryListItem[];
  total: number;
  page: number;
  pageSize: number;
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
export function createDelivery(
  direction: Direction,
  referenceNumber: string,
  packages: DraftPackage[],
  // Identifies the submit *attempt*, not the request: a retry after a timeout
  // sends the same key, and the server answers with the delivery it already
  // created rather than creating a second one for the same boxes.
  idempotencyKey: string
) {
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
  return request<DeliveryDetail>("/api/deliveries", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: form,
  });
}

/** Search, status filter and paging all happen server-side (DESIGN.md §4.3). */
export function listDeliveries({
  search,
  status,
  page,
}: {
  search?: string;
  status?: DeliveryStatusKey;
  page?: number;
} = {}) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (status) params.set("status", status);
  if (page && page > 1) params.set("page", String(page));

  const query = params.toString();
  return request<DeliveryPage>(`/api/deliveries${query ? `?${query}` : ""}`);
}

/** The dashboard's filters (DESIGN.md §4.4). Not the same set as §4.3's
 *  delivery statuses: these describe one package, not a whole delivery. */
export type PackageFilterKey = "OPENED" | "CHECK_FAILED" | "INCONCLUSIVE" | "PENDING" | "INTACT";

export interface PackageListItem {
  packageId: string;
  label: number;
  workflowStatus: WorkflowStatus;
  verdict: Verdict | null;
  verdictSource: "API" | "MANUAL" | null;
  needsManagerReview: boolean;
  /** Attempts on this package that ended in a failed call, not a verdict. */
  failedAttempts: number;
  deliveryId: string;
  deliveryInternalNumber: number;
  deliveryReference: string;
  direction: Direction;
}

export interface PackageStats {
  total: number;
  opened: number;
  inconclusive: number;
  checkFailed: number;
  pending: number;
}

export interface PackagePage {
  items: PackageListItem[];
  /** Counted over every package, so the cards are unaffected by the filters
   *  below them (DESIGN.md §4.4.1). */
  stats: PackageStats;
  total: number;
  page: number;
  pageSize: number;
}

/** Every package across every delivery, most urgent first (DESIGN.md §4.4). */
export function listPackages({
  search,
  filter,
  page,
}: {
  search?: string;
  filter?: PackageFilterKey;
  page?: number;
} = {}) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (filter) params.set("filter", filter);
  if (page && page > 1) params.set("page", String(page));

  const query = params.toString();
  return request<PackagePage>(`/api/packages${query ? `?${query}` : ""}`);
}

export function getDelivery(id: string) {
  return request<DeliveryDetail>(`/api/deliveries/${id}`);
}

/** The manager's verdict override (DESIGN.md §4.4.5). Two outcomes only —
 *  INCONCLUSIVE is what is being resolved, not something to choose. */
export function reviewPackage(packageId: string, verdict: "INTACT" | "OPENED", note: string) {
  return request<Package>(`/api/packages/${packageId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verdict, note }),
  });
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
