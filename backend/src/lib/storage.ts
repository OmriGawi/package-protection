import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { config } from "./config";

// Production doesn't mount the NAS — it calls an internal storage service
// whose contract is still unknown (DESIGN.md §7, §9). Everything above this
// interface deals in opaque storagePath strings, so swapping the transport
// later is a one-file change.
export interface StorageClient {
  /** `extension` includes the dot, and comes from the validated mime type — never from the uploaded filename. `keyPrefix` is "/"-separated. */
  save(buffer: Buffer, extension: string, keyPrefix: string): Promise<string>;
  read(storagePath: string): Promise<Buffer>;
  delete(storagePath: string): Promise<void>;
}

export class LocalDiskStorage implements StorageClient {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    // Resolved once, because containment below is a string prefix comparison.
    this.rootDir = path.resolve(rootDir);
  }

  async save(buffer: Buffer, extension: string, keyPrefix: string): Promise<string> {
    // Relative, so the stored path stays valid if the root directory moves, and
    // POSIX-separated so a key written on Windows still resolves on Linux.
    const storagePath = path.posix.join(keyPrefix, `${randomUUID()}${extension}`);
    const absolutePath = this.resolve(storagePath);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, buffer);

    return storagePath;
  }

  async read(storagePath: string): Promise<Buffer> {
    return fs.readFile(this.resolve(storagePath));
  }

  async delete(storagePath: string): Promise<void> {
    await fs.rm(this.resolve(storagePath), { force: true });
  }

  private resolve(storagePath: string): string {
    const segments = storagePath.split("/");
    // A storagePath comes out of our own database, so it is always relative,
    // "/"-separated and free of traversal. Anything else is corrupt or hostile,
    // and saying so beats resolving it to some file that happens to exist.
    if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.includes("\\"))) {
      throw new Error("storagePath escapes the storage root");
    }

    const absolutePath = path.resolve(this.rootDir, ...segments);
    if (!absolutePath.startsWith(this.rootDir + path.sep)) {
      throw new Error("storagePath escapes the storage root");
    }
    return absolutePath;
  }
}

export const storage: StorageClient = new LocalDiskStorage(
  path.resolve(config.storageDir ?? path.join(__dirname, "../../storage"))
);
