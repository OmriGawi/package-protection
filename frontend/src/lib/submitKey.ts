/**
 * A key identifying one submit attempt.
 *
 * `crypto.randomUUID` exists only in a secure context, and the phone taking the
 * photos (DESIGN.md §4.2) may well be pointed at a plain-HTTP LAN address
 * during testing — where the call is not merely unavailable but `undefined`,
 * so reaching for it throws. The fallback is not cryptographically strong and
 * does not need to be: this value only has to be unlikely to collide with
 * another submit, and the server rejects anything that is not UUID-shaped.
 */
export function newSubmitKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  // Version 4, variant 1 — the shape the API validates.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
