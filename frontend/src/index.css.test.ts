import { describe, expect, it } from "vitest";
// Vite's ?raw import rather than node:fs — the frontend has no @types/node and
// this needs no dependency to add one.
import css from "./index.css?raw";

/**
 * The status hues are the whole point of the badges (DESIGN.md §4.3) and of
 * every error line, so they are the colors it matters most that people can
 * read. This locks them at WCAG AA for normal text: the originals shipped
 * between 2.6:1 and 4.1:1, and nothing catches that in review by eye.
 */
const AA_NORMAL_TEXT = 4.5;

function token(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6,8});`));
  if (!match) throw new Error(`token --${name} not found in index.css`);
  return match[1];
}

/** sRGB → relative luminance, per WCAG 2.1. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** A `-soft` token is the hue at low alpha, so it only exists once composited
 *  over what is behind it — the page background. */
function flatten(hex: string, backdrop: string): string {
  if (hex.length === 7) return hex;
  const alpha = parseInt(hex.slice(7, 9), 16) / 255;
  const mixed = [1, 3, 5].map((offset) => {
    const top = parseInt(hex.slice(offset, offset + 2), 16);
    const bottom = parseInt(backdrop.slice(offset, offset + 2), 16);
    return Math.round(top * alpha + bottom * (1 - alpha));
  });
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const HUES = ["red", "green", "amber", "blue", "purple"];

describe("status colors", () => {
  const pageBackground = token("bg");

  it.each(HUES)("reads as a badge: --%s on its own soft background", (hue) => {
    const badgeBackground = flatten(token(`${hue}-soft`), pageBackground);
    expect(contrast(token(hue), badgeBackground)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it.each(HUES)("reads as plain text: --%s on the page background", (hue) => {
    expect(contrast(token(hue), pageBackground)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it.each(HUES)("carries white text: --%s as a filled background", (hue) => {
    expect(contrast("#ffffff", token(hue))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("keeps the text colors readable too", () => {
    expect(contrast(token("navy"), pageBackground)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrast(token("text-secondary"), pageBackground)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});
