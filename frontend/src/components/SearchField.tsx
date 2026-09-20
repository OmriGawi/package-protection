const WIDTH = 280;

/** The search box used by both list screens (DESIGN.md §4.3, §4.4).
 *
 * Extracted rather than copied: the magnifier is absolutely positioned over
 * padding the input has to reserve, so the icon and that padding have to stay
 * in step — two copies drift. */
export function SearchField({
  value,
  onChange,
  label,
  placeholder = "חיפוש לפי מספר משלוח או מספר הזמנה",
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}) {
  return (
    <div style={{ position: "relative", width: WIDTH, maxWidth: "100%" }}>
      <input
        className="field"
        // Not type="search": Chrome and Safari draw their own clear button
        // inside the field, which lands on top of the magnifier below.
        type="text"
        style={{ paddingRight: 34 }}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
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
        stroke="var(--icon-muted)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        // Without this a click on the icon — a natural target, it sits at the
        // text-start edge — lands on the SVG and never focuses the field.
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
  );
}
