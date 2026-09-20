import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { listPackages, type PackageFilterKey, type PackagePage } from "../api/client";
import { RowChevron } from "../components/RowChevron";
import { SearchField } from "../components/SearchField";
import { TableSkeleton } from "../components/TableSkeleton";
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
  { key: "total", label: "סה״כ חבילות", color: "var(--text)", filter: null },
  { key: "opened", label: "נפתחו", color: "var(--red)", filter: "OPENED" },
  { key: "inconclusive", label: "דורשות בדיקה", color: "var(--amber)", filter: "INCONCLUSIVE" },
  { key: "pending", label: "ממתינות", color: "var(--text)", filter: "PENDING" },
  { key: "checkFailed", label: "שגיאת בדיקה", color: "var(--purple)", filter: "CHECK_FAILED" },
] as const satisfies readonly { key: string; label: string; color: string; filter: PackageFilterKey | null }[];

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

  // from=dashboard rides in the URL rather than history state so a refresh on
  // the evidence page still knows where Back should return to.
  function evidencePath(deliveryId: string, label: number) {
    return `/deliveries/${deliveryId}?package=${label}&from=dashboard`;
  }

  function openEvidence(deliveryId: string, label: number) {
    navigate(evidencePath(deliveryId, label));
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

      {/* Each card sets the filter it counts — a manager reading "12 opened"
          wants those twelve, and the card is where they are already looking.
          The counts themselves stay global (§4.4.1): they describe the
          operation, not the filtered page, so clicking one never changes the
          number on it. */}
      <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
        {CARDS.map((card) => {
          const active = card.filter === null ? filter === null : filter === card.filter;
          return (
            <button
              key={card.key}
              type="button"
              // Same state the matching chip carries, read off the same URL
              // param, so the two rows cannot disagree about what is selected.
              aria-pressed={active}
              className="card stat-card"
              onClick={() => updateParams({ filter: card.filter, page: null })}
            >
              <span className="text-[11.5px]" style={{ color: card.color }}>
                {card.label}
              </span>
              <span className="text-[22px] font-extrabold mt-1 block" style={{ color: card.color }}>
                {result ? result.stats[card.key] : "—"}
              </span>
            </button>
          );
        })}
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
                className="chip"
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

      {/* Filtering and paging swap the rows underneath without moving focus, so
          nothing tells a screen reader that the table changed. Always in the
          DOM, because a live region created at the same moment its text appears
          is not announced. aria-live without role="status": the toast already
          owns that role, and two status nodes would be ambiguous. The wording
          is the count rather than the pager's range — what changed is how many
          rows there are. */}
      <p className="sr-only" aria-live="polite">
        {result ? `נמצאו ${result.total} חבילות` : ""}
      </p>

      <div className="rounded-2xl bg-white shadow-sm overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        {error ? (
          <p role="alert" className="px-6 py-5 text-[13px]" style={{ color: "var(--red)" }}>
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
                  {/* Nothing has arrived yet: the empty states below all say
                      something specific, and every one of them would be a lie
                      while the first request is still in flight. */}
                  {!result && <TableSkeleton columns={8} />}
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
                        {/* Same pair as the deliveries table: the row click is
                            for the mouse, the link is what keyboard and screen
                            reader users actually reach. */}
                        <td className="px-6 py-4 font-semibold">
                          <Link
                            to={evidencePath(row.deliveryId, row.label)}
                            className="row-link"
                            onClick={(event) => event.stopPropagation()}
                          >
                            #{row.deliveryInternalNumber}
                          </Link>
                        </td>
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
                          {/* A package that has burned several calls is a
                              different problem from one that failed once, and
                              nothing else in the row says so. Shown from the
                              second failure — the first is what the badge
                              already means — and only while the package is
                              still failing: the count outlives the failures, so
                              on a package that eventually came back INTACT it
                              would sit beside a green badge saying the
                              opposite. */}
                          {row.workflowStatus === "CHECK_FAILED" && row.failedAttempts > 1 && (
                            <span
                              className="mr-2 text-[11.5px] font-semibold"
                              style={{ color: "var(--text-secondary)" }}
                            >
                              {row.failedAttempts} ניסיונות
                            </span>
                          )}
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
