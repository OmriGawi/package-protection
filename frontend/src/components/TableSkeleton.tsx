/** Placeholder rows for a table whose first page has not arrived yet.
 *
 *  An empty table and a table still loading look identical otherwise, and the
 *  empty states on both screens say something specific and wrong in that
 *  moment ("no deliveries yet", "nothing matched the search").
 */
export function TableSkeleton({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <tr key={rowIndex} style={{ borderTop: "1px solid var(--border)" }}>
          {Array.from({ length: columns }, (_, columnIndex) => (
            <td key={columnIndex} className="px-6 py-4">
              {/* Uneven widths, so the block reads as rows of text rather than
                  as a grid of identical bars. */}
              <span className="skeleton" style={{ width: `${[60, 80, 40, 70, 55, 30][columnIndex % 6]}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
