import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { listDeliveries, type DeliveryPage, type DeliveryStatusKey } from "../api/client";
import { Logo } from "../components/Logo";
import { RowChevron } from "../components/RowChevron";
import { Toast } from "../components/Toast";
import { DELIVERY_STATUS_INFO, STATUS_FILTERS, formatDate } from "../lib/display";

const SEARCH_DEBOUNCE_MS = 300;

/** Handed over by CreateDeliveryPage through history state. */
export type CreatedDelivery = {
  id: string;
  internalNumber: number;
  referenceNumber: string;
  packageCount: number;
};

export function DeliveriesPage() {
  const navigate = useNavigate();
  // Kept in the URL so a filtered view survives a refresh and the browser's
  // back button steps through it.
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const status = (params.get("status") as DeliveryStatusKey | null) ?? null;
  // A hand-edited ?page=abc or ?page=0 must not produce "עמוד NaN" and a
  // Next button that writes NaN back into the URL.
  const rawPage = Number(params.get("page"));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

  const [searchInput, setSearchInput] = useState(search);
  const [result, setResult] = useState<DeliveryPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read once into state, then wiped from history: a refresh or a Back onto
  // this entry must not re-announce a delivery created minutes ago.
  const location = useLocation();
  const [created, setCreated] = useState<CreatedDelivery | null>(
    (location.state as { created?: CreatedDelivery } | null)?.created ?? null
  );
  // Cleared through the router, never with window.history.replaceState: React
  // Router keeps its own { usr, key, idx } in history state, and overwriting
  // that with {} leaves idx undefined — truthy enough to defeat the library's
  // `|| { idx: null }` fallback, after which pop tracking is broken for the
  // rest of the session.
  useEffect(() => {
    if (!(location.state as { created?: CreatedDelivery } | null)?.created) return;
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location.state, location.pathname, location.search, navigate]);

  // The input is what the user types; the URL is what gets queried. Debounced
  // so a fetch doesn't fire per keystroke.
  useEffect(() => {
    if (searchInput === search) return;
    const timer = setTimeout(() => {
      updateParams({ search: searchInput || null, page: null });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // Browser back can change the URL without touching the input.
  useEffect(() => setSearchInput(search), [search]);

  useEffect(() => {
    // Guarded against a slow earlier request resolving last and painting rows
    // for a filter the user has already moved off.
    let current = true;
    setError(null);
    listDeliveries({ search: search || undefined, status: status ?? undefined, page })
      .then((next) => {
        if (current) setResult(next);
      })
      .catch(() => {
        if (current) setError("טעינת המשלוחים נכשלה");
      });
    return () => {
      current = false;
    };
  }, [search, status, page]);

  // Merged from a ref rather than from `params` or setParams' functional form:
  // the debounced search commit fires from a closure created up to 300ms
  // earlier, and both of those read the params as they were then — which
  // silently drops a status chip clicked in the meantime.
  const paramsRef = useRef(params);
  paramsRef.current = params;

  function updateParams(changes: Record<string, string | null>) {
    const next = new URLSearchParams(paramsRef.current);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  }

  const pageCount = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const isFiltered = Boolean(search || status);

  // Counted off the rows actually returned, not off page × pageSize: a page
  // past the end has a first-row number but no rows, and "מציג 241–260" over an
  // empty table would be a lie. Both ends need that guard, not just the start.
  //
  // The offset comes from the server's echoed page rather than the URL's: the
  // previous result stays on screen until the new fetch resolves, so reading
  // the URL would renumber rows 1-20 as 21-40 for as long as that takes.
  const offset = result ? (result.page - 1) * result.pageSize : 0;
  const hasRows = Boolean(result && result.items.length > 0);
  const rangeStart = hasRows ? offset + 1 : 0;
  const rangeEnd = hasRows && result ? offset + result.items.length : 0;

  return (
    <>
      <div className="flex flex-col items-center mb-12">
        <Logo size="hero" />
        <div className="text-center" style={{ marginTop: 14 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#12384c" }}>מערכת להגנה על אריזות</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "#2b7fae", marginTop: 6, letterSpacing: ".02em" }}>
            אבטחת אריזות מקצה לקצה
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <h1 className="text-[26px] font-extrabold tracking-tight" style={{ color: "var(--navy)" }}>
          המשלוחים שלי
        </h1>
        <button type="button" className="btn-primary" onClick={() => navigate("/deliveries/new")}>
          משלוח חדש
        </button>
      </div>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div style={{ position: "relative", width: 280, maxWidth: "100%" }}>
          <input
            className="field"
            // Not type="search": Chrome and Safari draw their own clear button
            // inside the field, which lands on top of the magnifier below.
            type="text"
            style={{ paddingRight: 34 }}
            placeholder="חיפוש לפי מספר משלוח או מספר הזמנה"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            aria-label="חיפוש משלוחים"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
            data-form-type="other"
          />
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#00000055"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            // Without this a click on the icon — a natural target, it sits at
            // the text-start edge — lands on the SVG and never focuses the field.
            style={{
              position: "absolute",
              right: 11,
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none",
            }}
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_FILTERS.map((filter) => {
            const active = filter.key === "ALL" ? status === null : status === filter.key;
            return (
              <button
                key={filter.key}
                type="button"
                aria-pressed={active}
                className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition"
                style={
                  active
                    ? { background: "var(--navy)", color: "#fff" }
                    : { background: "#00000008", color: "var(--text-secondary)" }
                }
                onClick={() =>
                  updateParams({ status: filter.key === "ALL" ? null : filter.key, page: null })
                }
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl bg-white shadow-sm overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        {error ? (
          <p className="px-6 py-5 text-[13px]" style={{ color: "var(--red)" }}>
            {error}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["מס' משלוח", "מס' הזמנה / תעודת משלוח", "חבילות", "סטטוס", "נוצר בתאריך"].map((heading) => (
                      <th
                        key={heading}
                        className="text-right font-semibold px-6 py-3.5 text-[11.5px]"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {heading}
                      </th>
                    ))}
                    {/* Holds the row chevron. Empty on purpose — a header over
                        a decorative icon would be read out by a screen reader. */}
                    <th className="px-6 py-3.5" />
                  </tr>
                </thead>
                <tbody>
                  {result && result.items.length === 0 && (
                    // Three different causes, three different messages. An empty
                    // page of a non-empty result is not "nothing matched", and
                    // neither is "nothing matched" the same as having no
                    // deliveries at all.
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-[13px]" style={{ color: "var(--text-secondary)" }}>
                        {result.total > 0
                          ? "אין משלוחים בעמוד זה."
                          : isFiltered
                            ? "לא נמצאו משלוחים התואמים לחיפוש."
                            : 'עדיין לא נוצרו משלוחים. לחצו על "משלוח חדש" כדי להתחיל.'}
                      </td>
                    </tr>
                  )}
                  {(result?.items ?? []).map((delivery) => {
                    const badge = DELIVERY_STATUS_INFO[delivery.attentionStatus];
                    return (
                      <tr
                        key={delivery.id}
                        className={
                          delivery.id === created?.id
                            ? "row-hover cursor-pointer row-flash"
                            : "row-hover cursor-pointer"
                        }
                        style={{ borderTop: "1px solid var(--border)" }}
                        onClick={() => navigate(`/deliveries/${delivery.id}`)}
                      >
                        <td className="px-6 py-4 font-semibold">#{delivery.internalNumber}</td>
                        <td
                          className="px-6 py-4"
                          style={{ color: "var(--text-secondary)", direction: "ltr", textAlign: "right" }}
                        >
                          {delivery.referenceNumber}
                        </td>
                        <td className="px-6 py-4" style={{ color: "var(--text-secondary)" }}>
                          {delivery.packageCount}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className="inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-semibold"
                            style={{ color: badge.color, background: badge.bg }}
                          >
                            {badge.text}
                          </span>
                        </td>
                        <td className="px-6 py-4" style={{ color: "var(--text-secondary)" }}>
                          {formatDate(delivery.createdAt)}
                        </td>
                        <td className="px-6 py-4 text-left" style={{ color: "var(--text-secondary)" }}>
                          <RowChevron />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Hidden only when there is nothing at all to page through. An
                empty page of a non-empty result keeps its pager, since that is
                the only way back to a page that has rows. */}
            {result && result.total > 0 && (
              <div
                className="flex items-center justify-between px-6 py-3.5"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <span className="text-[12.5px]" style={{ color: "var(--text-secondary)" }}>
                  {hasRows ? `מציג ${rangeStart}–${rangeEnd} מתוך ${result.total}` : `0 מתוך ${result.total}`}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold disabled:opacity-35 disabled:cursor-not-allowed"
                    style={{ border: "1px solid #00000018", color: "var(--text)", background: "#fff" }}
                    disabled={page <= 1}
                    onClick={() => updateParams({ page: String(page - 1) })}
                  >
                    הקודם
                  </button>
                  <span className="text-[12.5px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                    עמוד {page} מתוך {pageCount}
                  </span>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold disabled:opacity-35 disabled:cursor-not-allowed"
                    style={{ border: "1px solid #00000018", color: "var(--text)", background: "#fff" }}
                    disabled={page >= pageCount}
                    onClick={() => updateParams({ page: String(page + 1) })}
                  >
                    הבא
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {created && (
        <Toast
          title={`משלוח ${created.referenceNumber} נוצר בהצלחה`}
          detail={`${created.packageCount} חבילות · מס' משלוח #${created.internalNumber}`}
          onDismiss={() => setCreated(null)}
        />
      )}
    </>
  );
}
