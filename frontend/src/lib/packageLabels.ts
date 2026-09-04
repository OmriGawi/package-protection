import type { DraftPackage } from "../api/client";

/**
 * The next number the employee should write on a box.
 *
 * Deliberately `max + 1` rather than `count + 1`: the number is handwritten on
 * a physical carton, so removing package 2 of 1,2,3 must not hand "3" out a
 * second time (which is what ui/index.html's savePackage does) and must not
 * renumber the boxes already marked. Gaps are fine — labels only need to be
 * unique within their delivery (DESIGN.md §3).
 */
export function nextPackageLabel(packages: Pick<DraftPackage, "label">[]): number {
  return packages.reduce((max, pkg) => Math.max(max, pkg.label), 0) + 1;
}
