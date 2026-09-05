import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { listPackages, type PackageFilterKey, type PackagePage } from "../api/client";
import { RowChevron } from "../components/RowChevron";
import { SearchField } from "../components/SearchField";
import { DIRECTION_TEXT, PACKAGE_FILTERS, verdictInfo, verdictSourceText } from "../lib/display";

const SEARCH_DEBOUNCE_MS = 300;

// "ALL" is the chip for "no filter", not a value the API accepts — leaving it
// in would turn /dashboard?filter=ALL into a 400 and an error message, where an
// unrecognised filter is supposed to just show everything.
const FILTER_KEYS = PACKAGE_FILTERS.map((filter) => filter.key).filter(
  (key): key is PackageFilterKey => key !== "ALL"
);

function isFilterKey(value: string): value is PackageFilterKey {
  return FILTER_KEYS.includes(value as PackageFilterKey);
}

/** The five cards (DESIGN.md §4.4.1). Colors carry the same meanings they do
 *  in a verdict badge, so "failed" is purple: an operational hiccup, not
 *  evidence of tampering. */
const CARDS = [
  { key: "total", label: "סה״כ חבילות", color: "var(--text)" },
  { key: "opened", label: "נפתחו", color: "var(--red)" },
  { key: "inconclusive", label: "דורשות בדיקה", color: "var(--amber)" },
  { key: "pending", label: "ממתינות", color: "var(--text)" },
  { key: "checkFailed", label: "שגיאת בדיקה", color: "var(--purple)" },
] as const;

/**
 * The Inventory Manager's dashboard (DESIGN.md §4.4).
 *
 * Every package across every delivery, most urgent first. The row is a link to
 * the evidence, not a second photo viewer — clicking it deep-links into that
 * package's existing panel on the Delivery Packages page (§4.2).
 */
export function DashboardPage() {
  const navigate = useNavigate();
  // In the URL for the same reason as §4.3: a filtered view survives a refresh
  // and the back button steps through it.
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const rawFilter = params.get("filter");
  const filter = rawFilter && isFilterKey(rawFilter) ? rawFilter : null;
  const rawPage = Number(params.get("page"));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

  const [searchInput, setSearchInput] = useState(search);
  const [result, setResult] = useState<PackagePage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (searchInput === search) return;
    const timer = setTimeout(() => {
      updateParams({ search: searchInput || null, page: null });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  useEffect(() => setSearchInput(search), [search]);

  useEffect(() => {
    // Guarded against a slow earlier request resolving last and painting rows
    // for a filter the user has already moved off.
    let current = true;
    setError(null);
    listPackages({ search: search || undefined, filter: filter ?? undefined, page })
      .then((next) => {
        if (current) setResult(next);
      })
      .catch(() => {
        if (current) setError("טעינת החבילות נכשלה");
      });
    return () => {
      current = false;
    };
  }, [search, filter, page]);

  // Merged from a ref, not from `params`: the debounced search commit fires
  // from a closure created up to 300ms earlier and would otherwise drop a chip
  // clicked in the meantime.
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

  function openEvidence(deliveryId: string, label: number) {
    // from=dashboard rides in the URL rather than history state so a refresh on
    // the evidence page still knows where Back should return to.
    navigate(`/deliveries/${deliveryId}?package=${label}&from=dashboard`);
  }

  const pageCount = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const offset = result ? (result.page - 1) * result.pageSize : 0;
  const hasRows = Boolean(result && result.items.length > 0);
  const rangeStart = hasRows ? offset + 1 : 0;
  const rangeEnd = hasRows && result ? offset + result.items.length : 0;

  return (
    <>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <h1 className="text-[26px] font-extrabold tracking-tight" style={{ color: "var(--navy)" }}>
          לוח בקרה
        </h1>
      </div>

      <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
        {CARDS.map((card) => (
          <div key={card.key} className="card" style={{ padding: "16px 18px" }}>
            <div className="text-[11.5px]" style={{ color: card.color }}>
              {card.label}
            </div>
            <div className="text-[22px] font-extrabold mt-1" style={{ color: card.color }}>
              {result ? result.stats[card.key] : "—"}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <SearchField value={searchInput} onChange={setSearchInput} label="חיפוש חבילות" />

        <div className="flex items-center gap-2 flex-wrap">
          {PACKAGE_FILTERS.map((chip) => {
            const active = chip.key === "ALL" ? filter === null : filter === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                aria-pressed={active}
                className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition"
                style={
                  active
                    ? { background: "var(--navy)", color: "#fff" }
                    : { background: "#00000008", color: "var(--text-secondary)" }
                }
                onClick={() =>
                  updateParams({ filter: chip.key === "ALL" ? null : chip.key, page: null })
                }
              >
                {chip.label}
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
                    {["מס' משלוח", "מס' הזמנה / תעודת משלוח", "כיוון", "חבילה", "תוצאה", "מקור"].map(
                      (heading) => (
                        <th
                          key={heading}
                          className="text-right font-semibold px-6 py-3.5 text-[11.5px]"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {heading}
                        </th>
                      )
                    )}
                    {/* Review action, then the row chevron — neither names a
                        column of data. */}
                    <th className="px-6 py-3.5" />
                    <th className="px-6 py-3.5" />
                  </tr>
                </thead>
                <tbody>
                  {result && result.items.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-[13px]" style={{ color: "var(--text-secondary)" }}>
                        {result.total > 0 ? "אין חבילות בעמוד זה." : "לא נמצאו חבילות תואמות."}
                      </td>
                    </tr>
                  )}
                  {(result?.items ?? []).map((row) => {
                    const badge = verdictInfo(row);
                    return (
                      <tr
                        key={row.packageId}
                        className="row-hover cursor-pointer"
                        style={{ borderTop: "1px solid var(--border)" }}
                        onClick={() => openEvidence(row.deliveryId, row.label)}
                      >
                        <td className="px-6 py-4 font-semibold">#{row.deliveryInternalNumber}</td>
                        <td
                          className="px-6 py-4"
                          style={{ color: "var(--text-secondary)", direction: "ltr", textAlign: "right" }}
                        >
                          {row.deliveryReference}
                        </td>
                        <td className="px-6 py-4" style={{ color: "var(--text-secondary)" }}>
                          {DIRECTION_TEXT[row.direction]}
                        </td>
                        <td className="px-6 py-4 font-semibold">{row.label}</td>
                        <td className="px-6 py-4">
                          <span
                            className="inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-semibold"
                            style={{ color: badge.color, background: badge.bg }}
                          >
                            {badge.text}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-[12.5px]" style={{ color: "var(--text-secondary)" }}>
                          {verdictSourceText(row)}
                        </td>
                        <td className="px-6 py-4 text-left">
                          {/* Only where a human can still change the verdict
                              (§4.4.4). Same destination as the row — the button
                              marks which rows are waiting on a decision. */}
                          {row.needsManagerReview && (
                            <button
                              type="button"
                              className="px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold"
                              style={{ border: "1px solid var(--navy)", color: "var(--navy)" }}
                              onClick={(event) => {
                                event.stopPropagation();
                                openEvidence(row.deliveryId, row.label);
                              }}
                            >
                              סקירה
                            </button>
                          )}
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
    </>
  );
}
