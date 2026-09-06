import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { renameWithRetry } from "./renameWithRetry.ts";

const queues = new Map<string, Promise<void>>();
const activeTransactions = new AsyncLocalStorage<ReadonlySet<string>>();

/** Shared by all services and instances using the same configuration file.
 * The lock covers the complete read/modify/write operation within this process.
 */
export class JsonConfigurationRepository {
  private readonly file: string;
  private readonly key: string;

  constructor(file: string) {
    this.file = path.resolve(file);
    this.key = process.platform === "win32" ? this.file.toLowerCase() : this.file;
  }

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const active = activeTransactions.getStore();
    if (active?.has(this.key)) {
      return operation();
    }

    const previous = queues.get(this.key) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => pending);
    queues.set(this.key, tail);
    await previous;
    try {
      return await activeTransactions.run(
        new Set([...(active ?? []), this.key]),
        operation
      );
    } finally {
      release();
      if (queues.get(this.key) === tail) queues.delete(this.key);
    }
  }

  read<T extends object = Record<string, unknown>>(): Promise<T> {
    return this.runExclusive(async () => {
      try {
        const value: unknown = JSON.parse(await readFile(this.file, "utf8"));
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          throw new TypeError("The Cortex configuration must be a JSON object.");
        }
        return value as T;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {} as T;
        throw error;
      }
    });
  }

  update<T extends object>(mutate: (configuration: T) => T | Promise<T>): Promise<void> {
    return this.runExclusive(async () => {
      await this.replace(await mutate(await this.read<T>()));
    });
  }

  replace(configuration: object): Promise<void> {
    return this.runExclusive(async () => {
      const content = JSON.stringify(configuration, null, 2);
      const temporaryFile = `${this.file}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporaryFile, "wx", 0o600);
        try {
          await file.writeFile(content, "utf8");
          await file.sync();
        } finally {
          await file.close();
        }
        await renameWithRetry(temporaryFile, this.file);
      } finally {
        await unlink(temporaryFile).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    });
  }
}
