import { describe, expect, it } from "vitest";
import zlib from "zlib";
import { solidPng } from "./solidPng";
import { detectImageType } from "./imageTypes";

describe("solidPng", () => {
  it("produces something the app recognises as a PNG", () => {
    // The same check routes/images.ts relies on to serve the right content
    // type, so a seeded image that fails here would render as a broken box.
    expect(detectImageType(solidPng(4, 4, [200, 30, 30]))).toBe("image/png");
  });

  it("writes the requested dimensions into the header", () => {
    const png = solidPng(7, 3, [0, 0, 0]);
    // IHDR data starts 16 bytes in: 8 signature + 4 length + 4 type.
    expect(png.readUInt32BE(16)).toBe(7);
    expect(png.readUInt32BE(20)).toBe(3);
  });

  it("round-trips the colour it was given", () => {
    const png = solidPng(2, 2, [10, 20, 30]);
    const idatStart = png.indexOf(Buffer.from("IDAT", "latin1")) + 4;
    const idatLength = png.readUInt32BE(idatStart - 8);
    const raw = zlib.inflateSync(png.subarray(idatStart, idatStart + idatLength));

    // Row 0: a filter byte, then two RGB triples.
    expect(Array.from(raw.subarray(0, 7))).toEqual([0, 10, 20, 30, 10, 20, 30]);
  });

  it("refuses a zero-sized image rather than emitting an undecodable file", () => {
    expect(() => solidPng(0, 5, [0, 0, 0])).toThrow(/at least 1/);
  });
});
