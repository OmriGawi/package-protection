import { describe, expect, it } from "vitest";
// Vite's ?raw import rather than node:fs — the frontend has no @types/node and
// this needs no dependency to add one.
import css from "./index.css?raw";

/**
 * The status hues are the whole point of the badges (DESIGN.md §4.3) and of
 * every error line, so they are the colors it matters most that people can
 * read. This locks them at WCAG AA for normal text, in both themes: the
 * originals shipped between 2.6:1 and 4.1:1, and nothing catches that by eye.
 */
const AA_NORMAL_TEXT = 4.5;

// Comments first: a prose mention of "--surface:" inside one reads exactly
// like a declaration to the parser below, and swallows the real one after it.
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The three token blocks: the light default, and dark twice over — once for
 *  the system preference, once for the header toggle's explicit choice. */
function block(selector: string): Record<string, string> {
  const start = declarations.indexOf(selector);
  if (start === -1) throw new Error(`no block for ${selector}`);
  const body = declarations.slice(start + selector.length, declarations.indexOf("\n}", start));
  const tokens: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

const THEMES = {
  light: block(":root {"),
  "dark (system)": block(':root:not([data-theme="light"]) {'),
  "dark (chosen)": block(':root[data-theme="dark"] {'),
};

/** sRGB → relative luminance, per WCAG 2.1. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** A `-soft` token is the hue at low alpha, so it only exists once composited
 *  over what is behind it — the card it sits on. */
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

describe.each(Object.entries(THEMES))("status colors — %s", (_theme, tokens) => {
  const surface = tokens.surface;
  const page = tokens.bg;

  it.each(HUES)("reads as a badge: --%s on its own soft background", (hue) => {
    expect(contrast(tokens[hue], flatten(tokens[`${hue}-soft`], surface))).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT
    );
  });

  it.each(HUES)("reads as plain text: --%s on a card", (hue) => {
    expect(contrast(tokens[hue], surface)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it.each(HUES)("carries --on-accent: --%s as a filled background", (hue) => {
    expect(contrast(tokens["on-accent"], tokens[hue])).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("keeps the text colors readable, on the page and on a card", () => {
    for (const name of ["text", "text-secondary", "brand", "wordmark", "wordmark-sub"]) {
      expect(contrast(tokens[name], page), `--${name} on --bg`).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT
      );
      expect(contrast(tokens[name], surface), `--${name} on --surface`).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT
      );
    }
  });

  it("keeps --on-brand readable on the brand fill", () => {
    expect(contrast(tokens["on-brand"], tokens.brand)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});

describe("theme blocks", () => {
  it("defines the same tokens in both dark blocks", () => {
    // Two blocks is the price of letting the toggle override the system in
    // either direction. They must not drift.
    expect(THEMES["dark (chosen)"]).toEqual(THEMES["dark (system)"]);
  });

  it("gives every light token a dark counterpart", () => {
    expect(Object.keys(THEMES["dark (system)"]).sort()).toEqual(Object.keys(THEMES.light).sort());
  });
});
