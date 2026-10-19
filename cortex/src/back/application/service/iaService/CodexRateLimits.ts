import { withCodexAppServer } from "./CodexAppServer.ts";
import type { CodexCommand } from "./CodexCommand.ts";

/** Read the server's own Codex account without starting an inference turn. */
export function readCodexRateLimits(workingDirectory: string, command?: CodexCommand, timeoutMs = 15_000): Promise<unknown> {
  return withCodexAppServer(workingDirectory, session => session.request("account/rateLimits/read", {}), command, timeoutMs);
}
