import { rename } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

/** Windows readers/antivirus can briefly prevent replacement. Never unlink the
 * destination as a fallback: the previous complete file must remain available.
 */
export async function renameWithRetry(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== "win32" || attempt >= 20 ||
        !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) {
        throw error;
      }
      await setTimeout(Math.min(10 * (attempt + 1), 100));
    }
  }
}
