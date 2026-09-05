import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  getDelivery,
  imageUrl,
  retryTamperCheck,
  type DeliveryDetail,
  type Package,
} from "../api/client";
import { ManagerReviewPanel } from "../components/ManagerReviewPanel";
import { ReceivePhotosPanel } from "../components/ReceivePhotosPanel";
import { RowChevron } from "../components/RowChevron";
import { DIRECTION_TEXT, WORKFLOW_TEXT, formatDate, verdictInfo } from "../lib/display";

type Expansion = { label: number; mode: "view" | "upload" } | null;

const POLL_INTERVAL_MS = 1000;

function PhotoGrid({ images }: { images: Package["images"] }) {
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(6,1fr)", maxWidth: 520 }}>
      {images.map((image) => (
        <a key={image.id} className="thumb" href={imageUrl(image.id)} target="_blank" rel="noreferrer">
          <img src={imageUrl(image.id)} alt={`תמונה ${image.sequence}`} />
        </a>
      ))}
    </div>
  );
}

export function DeliveryPackagesPage() {
  const { id } = useParams<{ id: string }>();
  // The dashboard links straight at one package's evidence (DESIGN.md §4.4.4).
  // Both live in the query string rather than history state so a refresh keeps
  // the panel open and Back still knows where it came from.
  const [params] = useSearchParams();
  const deepLinkedLabel = Number(params.get("package"));
  const cameFromDashboard = params.get("from") === "dashboard";

  const [delivery, setDelivery] = useState<DeliveryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Expansion>(null);

  const [uploadDirty, setUploadDirty] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return null;
    const next = await getDelivery(id);
    setDelivery(next);
    setError(null);
    return next;
  }, [id]);

  useEffect(() => {
    load().catch(() => setError("טעינת המשלוח נכשלה"));
  }, [load]);

  // Opened once, after the delivery arrives — the panel cannot be opened on a
  // package that has not been fetched yet. Not re-applied afterwards, so
  // collapsing the panel does not immediately reopen it.
  // Keyed by the link itself, not a bare boolean: this component stays mounted
  // across /deliveries/d1?package=2 → /deliveries/d7?package=3, and a boolean
  // would leave the second panel closed.
  const appliedDeepLink = useRef<string | null>(null);
  useEffect(() => {
    const key = `${id}:${deepLinkedLabel}`;
    if (appliedDeepLink.current === key || !delivery) return;
    if (!Number.isInteger(deepLinkedLabel)) return;
    if (!delivery.packages.some((p) => p.label === deepLinkedLabel)) return;
    appliedDeepLink.current = key;
    setExpanded({ label: deepLinkedLabel, mode: "view" });
  }, [delivery, deepLinkedLabel, id]);

  const checkingLabels = delivery?.packages.filter((p) => p.workflowStatus === "CHECKING") ?? [];
  const isChecking = checkingLabels.length > 0;

  // The check runs server-side and its result arrives whenever it arrives, so
  // the page polls only while something is actually in flight.
  const previouslyChecking = useRef<number[]>([]);
  const uploadDirtyRef = useRef(uploadDirty);
  uploadDirtyRef.current = uploadDirty;

  useEffect(() => {
    if (!isChecking) return;
    const timer = setInterval(() => {
      load()
        .then((next) => {
          if (!next) return;
          // A package that just resolved opens on its photos, so the verdict
          // and the evidence behind it land together (DESIGN.md §4.2).
          const stillChecking = next.packages.filter((p) => p.workflowStatus === "CHECKING").map((p) => p.label);
          const justResolved = previouslyChecking.current.find((label) => !stillChecking.includes(label));
          // Never steal an upload panel that has photos picked in it — a
          // background event must not bin work the employee is mid-way through.
          if (justResolved !== undefined && !uploadDirtyRef.current) {
            setExpanded({ label: justResolved, mode: "view" });
          }
          previouslyChecking.current = stillChecking;
        })
        .catch(() => {
          /* a failed poll is not fatal — the next tick tries again */
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isChecking, load]);

  useEffect(() => {
    previouslyChecking.current = checkingLabels.map((p) => p.label);
    // Only tracks which labels were mid-check at the time of the last render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delivery]);

  function toggleView(label: number) {
    // Clicking away from an upload panel with photos already picked would
    // discard them, so ask first — same guard as the pre-ship packages card.
    if (expanded?.mode === "upload" && uploadDirty) {
      if (!window.confirm("התמונות שטרם נשלחו יימחקו. להמשיך?")) return;
    }
    setExpanded((current) =>
      current?.label === label && current.mode === "view" ? null : { label, mode: "view" }
    );
  }

  async function retry(pkg: Package) {
    if (retrying) return;
    setRetrying(pkg.id);
    setError(null);
    try {
      await retryTamperCheck(pkg.id);
      await load();
    } catch {
      setError("הפעלת הבדיקה מחדש נכשלה");
    } finally {
      setRetrying(null);
    }
  }

  return (
    <>
      <Link
        to={cameFromDashboard ? "/dashboard" : "/deliveries"}
        className="inline-flex items-center gap-1.5 text-sm font-semibold mb-5"
        style={{ color: "var(--blue)" }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 6l6 6-6 6" />
        </svg>
        {cameFromDashboard ? "חזרה ללוח הבקרה" : "חזרה למשלוחים"}
      </Link>

      {error && (
        <p className="text-[13px]" style={{ color: "var(--red)" }}>
          {error}
        </p>
      )}

      {delivery && (
        <>
          <div className="mb-6">
            <h1 className="text-2xl font-extrabold" style={{ color: "var(--navy)" }} dir="ltr">
              {delivery.referenceNumber}
            </h1>
            <p className="mt-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
              מס&apos; משלוח #{delivery.internalNumber} · {DIRECTION_TEXT[delivery.direction]} · נוצר ב-
              {formatDate(delivery.createdAt)}
            </p>
          </div>

          <div className="rounded-2xl bg-white shadow-sm overflow-hidden" style={{ border: "1px solid var(--border)", maxWidth: 900 }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["חבילה", "סטטוס תהליך", "תוצאה"].map((heading) => (
                    <th key={heading} className="text-right font-semibold px-6 py-3.5 text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
                      {heading}
                    </th>
                  ))}
                  {/* Action button, then the row chevron. Both headerless —
                      neither cell holds a column of data to name. */}
                  <th className="px-6 py-3.5" />
                  <th className="px-6 py-3.5" />
                </tr>
              </thead>
              <tbody>
                {delivery.packages.map((pkg) => {
                  const badge = verdictInfo(pkg);
                  const isExpanded = expanded?.label === pkg.label;
                  const preShip = pkg.images.filter((image) => image.phase === "PRE_SHIP");
                  const postReceive = pkg.images.filter((image) => image.phase === "POST_RECEIVE");

                  return [
                    <tr
                      key={pkg.id}
                      className="row-hover cursor-pointer"
                      style={{ borderBottom: isExpanded ? "none" : "1px solid var(--border)" }}
                      onClick={() => toggleView(pkg.label)}
                    >
                      <td className="px-6 py-4 font-semibold">חבילה {pkg.label}</td>
                      <td className="px-6 py-4" style={{ color: "var(--text-secondary)" }}>
                        {WORKFLOW_TEXT[pkg.workflowStatus]}
                      </td>
                      <td className="px-6 py-4">
                        {pkg.workflowStatus === "CHECKING" ? (
                          <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold"
                            style={{ color: "var(--blue)", background: "var(--blue-soft)" }}
                          >
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full"
                              style={{ border: "2px solid #ffffff", borderTopColor: "var(--blue)", animation: "spin .7s linear infinite" }}
                            />
                            מבצע בדיקה…
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-semibold"
                            style={{ color: badge.color, background: badge.bg }}
                          >
                            {badge.text}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-left">
                        {pkg.workflowStatus === "SHIPPED" && (
                          <button
                            type="button"
                            className="px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold"
                            style={{ border: "1px solid #00000018", color: "var(--text)" }}
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpanded({ label: pkg.label, mode: "upload" });
                            }}
                          >
                            העלאת תמונות קבלה
                          </button>
                        )}
                        {pkg.workflowStatus === "CHECK_FAILED" && (
                          <button
                            type="button"
                            className="px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold disabled:opacity-35"
                            style={{ border: "1px solid var(--purple)", color: "var(--purple)" }}
                            disabled={retrying === pkg.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              retry(pkg);
                            }}
                          >
                            ניסיון חוזר
                          </button>
                        )}
                      </td>
                      <td className="px-6 py-4 text-left" style={{ color: "var(--text-secondary)" }}>
                        <RowChevron />
                      </td>
                    </tr>,

                    isExpanded && (
                      <tr
                        key={`${pkg.id}-panel`}
                        style={{ borderBottom: "1px solid var(--border)", background: "#fafbfc" }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <td colSpan={5} className="px-6 py-5">
                          {expanded?.mode === "upload" ? (
                            <ReceivePhotosPanel
                              packageId={pkg.id}
                              label={pkg.label}
                              onDirtyChange={setUploadDirty}
                              onSubmitted={() => {
                                setExpanded(null);
                                load().catch(() => setError("טעינת המשלוח נכשלה"));
                              }}
                              onCancel={() => setExpanded(null)}
                            />
                          ) : (
                            <>
                              <div className="text-[12px] font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
                                תמונות לפני משלוח
                              </div>
                              {preShip.length > 0 ? (
                                <PhotoGrid images={preShip} />
                              ) : (
                                <div className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                                  אין תמונות
                                </div>
                              )}

                              <div className="text-[12px] font-semibold mt-5 mb-2" style={{ color: "var(--text-secondary)" }}>
                                תמונות בקבלה
                              </div>
                              {postReceive.length > 0 ? (
                                <PhotoGrid images={postReceive} />
                              ) : (
                                <div className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                                  טרם הועלו תמונות קבלה
                                </div>
                              )}

                              <ManagerReviewPanel
                                pkg={pkg}
                                onReviewed={() =>
                                  load().catch(() => setError("טעינת המשלוח נכשלה"))
                                }
                              />
                            </>
                          )}
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
