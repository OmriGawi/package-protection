/** The affordance that marks a table row as clickable (ui/index.html).
 *
 * Points left, not right: the app is RTL, so "forward" is leftward. Lives in
 * its own trailing cell — the icon is decoration, so it is hidden from
 * assistive tech rather than announced on every row. */
export function RowChevron() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14 6l-6 6 6 6" />
    </svg>
  );
}
