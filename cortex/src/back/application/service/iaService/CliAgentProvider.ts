
import { execFile } from "node:child_process";

export abstract class CliAgentProvider {
  constructor(protected readonly workingDirectory: string) {}

  protected async runCommand(
    command: string,
    args: string[],
    timeout = 120_000,
    workingDirectory = this.workingDirectory,
    input?: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(command, args, {
        cwd: workingDirectory,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        timeout,
        windowsHide: true
      }, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(stdout.trim());
      });

      child.stdin?.end(input);
    });
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
