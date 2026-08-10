
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

      // Les CLI detectent sinon un stdin pipe et attendent indefiniment une
      // entree supplementaire, meme lorsque le prompt est passe en argument.
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
