
import { execFile } from "node:child_process";

export abstract class CliAgentProvider {
  constructor(protected readonly workingDirectory: string) {}

  protected async runCommand(
    command: string,
    args: string[],
    timeout = 120_000,
    workingDirectory = this.workingDirectory
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

      // Otherwise, CLIs detect piped stdin and wait indefinitely for more
      // input, even when the prompt is passed as an argument.
      child.stdin?.end();
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
