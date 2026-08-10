
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export abstract class CliAgentProvider {
  constructor(protected readonly workingDirectory: string) {}

  protected async runCommand(
    command: string,
    args: string[],
    timeout = 120_000
  ): Promise<string> {
    const { stdout } = await execFileAsync(command, args, {
      cwd: this.workingDirectory,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout,
      windowsHide: true
    });

    return stdout.trim();
  }

  protected async commandSucceeds(
    command: string,
    args: string[]
  ): Promise<boolean> {
    try {
      await this.runCommand(command, args, 10_000);
      return true;
    } catch {
      return false;
    }
  }
}
