declare module "archiver" {
  import type { Transform } from "node:stream";

  export interface ArchiverError extends Error {
    code: string;
  }

  export interface ZipArchiveOptions {
    zlib?: {
      level?: number;
    };
  }

  export class ZipArchive extends Transform {
    constructor(options?: ZipArchiveOptions);
    abort(): this;
    append(content: Buffer | string, data: { name: string }): this;
    directory(directoryPath: string, destinationPath: false | string): this;
    finalize(): Promise<void>;
    on(
      event: "warning" | "error",
      listener: (error: ArchiverError) => void
    ): this;
  }
}
