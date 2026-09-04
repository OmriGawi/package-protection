import { afterAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { LocalDiskStorage } from "./storage";

const root = path.join(os.tmpdir(), `pp-storage-test-${Date.now()}`);
const store = new LocalDiskStorage(root);

describe("LocalDiskStorage", () => {
  it("round-trips a saved file", async () => {
    const bytes = Buffer.from("pretend this is a jpeg");
    const storagePath = await store.save(bytes, ".jpg", "delivery-1/package-1");

    expect(storagePath.startsWith("delivery-1/package-1/")).toBe(true);
    expect(storagePath.endsWith(".jpg")).toBe(true);
    expect(await store.read(storagePath)).toEqual(bytes);
  });

  it("gives each save its own path, so identical uploads never collide", async () => {
    const first = await store.save(Buffer.from("a"), ".jpg", "d/p");
    const second = await store.save(Buffer.from("b"), ".jpg", "d/p");

    expect(first).not.toEqual(second);
    expect(await store.read(first)).toEqual(Buffer.from("a"));
    expect(await store.read(second)).toEqual(Buffer.from("b"));
  });

  it("deletes a file", async () => {
    const storagePath = await store.save(Buffer.from("temp"), ".png", "d/p");
    await store.delete(storagePath);

    await expect(store.read(storagePath)).rejects.toThrow();
  });

  it("refuses a storagePath that escapes the storage root", async () => {
    await expect(store.read("../../../etc/passwd")).rejects.toThrow(/escapes the storage root/);
  });
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
