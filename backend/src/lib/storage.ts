import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { config } from "./config";

// Production doesn't mount the NAS — it calls an internal storage service
// whose contract is still unknown (DESIGN.md §7, §9). Everything above this
// interface deals in opaque storagePath strings, so swapping the transport
// later is a one-file change.
export interface StorageClient {
  /** `extension` includes the dot, and comes from the validated mime type — never from the uploaded filename. */
  save(buffer: Buffer, extension: string, keyPrefix: string): Promise<string>;
  read(storagePath: string): Promise<Buffer>;
  delete(storagePath: string): Promise<void>;
}

export class LocalDiskStorage implements StorageClient {
  constructor(private readonly rootDir: string) {}

  async save(buffer: Buffer, extension: string, keyPrefix: string): Promise<string> {
    // Relative, so the stored path stays valid if the root directory moves.
    const storagePath = path.join(keyPrefix, `${randomUUID()}${extension}`);
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
    const absolutePath = path.resolve(this.rootDir, storagePath);
    // A storagePath comes out of our own database, but resolving it blindly
    // would still turn a stray "../" into a read of anything on disk.
    if (absolutePath !== this.rootDir && !absolutePath.startsWith(this.rootDir + path.sep)) {
      throw new Error("storagePath escapes the storage root");
    }
    return absolutePath;
  }
}

export const storage: StorageClient = new LocalDiskStorage(
  path.resolve(config.storageDir ?? path.join(__dirname, "../../storage"))
);
