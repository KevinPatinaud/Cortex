import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const WINDOWS_DIRECTORY_PICKER_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Selectionnez le repertoire du projet"
$dialog.ShowNewFolderButton = $true

if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Write($dialog.SelectedPath)
}

$dialog.Dispose()
`;

export class DirectoryPickerService {
  async selectDirectory(): Promise<string | null> {
    if (process.platform !== "win32") {
      throw new Error("Le selecteur natif est disponible uniquement sous Windows.");
    }

    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-STA", "-Command", WINDOWS_DIRECTORY_PICKER_SCRIPT],
      {
        encoding: "utf8",
        windowsHide: true
      }
    );

    return stdout.trim() || null;
  }
}
