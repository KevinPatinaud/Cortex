
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const WINDOWS_INSTRUCTIONS_FILE_PICKER_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Cortex.Windows
{
    [Flags]
    internal enum FileOpenOptions : uint
    {
        StrictFileTypes = 0x00000004,
        ForceFileSystem = 0x00000040,
        PathMustExist = 0x00000800,
        FileMustExist = 0x00001000,
        DontAddToRecent = 0x02000000
    }

    internal enum ShellItemDisplayName : uint
    {
        FileSystemPath = 0x80058000
    }

    internal enum FileDialogAddPlace
    {
        Bottom = 0,
        Top = 1
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct FilterSpec
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        public string Name;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string Spec;
    }

    [ComImport]
    [Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    internal class FileOpenDialog
    {
    }

    [ComImport]
    [Guid("42F85136-DB7E-439C-85F1-E4075D135FC8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IFileDialog
    {
        [PreserveSig]
        int Show(IntPtr owner);

        void SetFileTypes(
            uint fileTypeCount,
            [MarshalAs(UnmanagedType.LPArray)] FilterSpec[] filterSpecs
        );
        void SetFileTypeIndex(uint fileTypeIndex);
        void GetFileTypeIndex(out uint fileTypeIndex);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(FileOpenOptions options);
        void GetOptions(out FileOpenOptions options);
        void SetDefaultFolder(IShellItem shellItem);
        void SetFolder(IShellItem shellItem);
        void GetFolder(out IShellItem shellItem);
        void GetCurrentSelection(out IShellItem shellItem);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem shellItem);
        void AddPlace(IShellItem shellItem, FileDialogAddPlace alignment);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
        void Close(int result);
        void SetClientGuid(ref Guid clientGuid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
    }

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellItem
    {
        void BindToHandler(
            IntPtr bindContext,
            ref Guid handlerId,
            ref Guid interfaceId,
            out IntPtr interfacePointer
        );
        void GetParent(out IShellItem parent);
        void GetDisplayName(ShellItemDisplayName displayName, out IntPtr name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem shellItem, uint hint, out int order);
    }

    public static class InstructionsFilePicker
    {
        private const int Cancelled = unchecked((int)0x800704C7);

        public static string SelectFile()
        {
            IFileDialog dialog = (IFileDialog)new FileOpenDialog();
            IShellItem selectedItem = null;
            IntPtr selectedPathPointer = IntPtr.Zero;

            try
            {
                FileOpenOptions options;
                dialog.GetOptions(out options);
                dialog.SetOptions(
                    options |
                    FileOpenOptions.StrictFileTypes |
                    FileOpenOptions.ForceFileSystem |
                    FileOpenOptions.PathMustExist |
                    FileOpenOptions.FileMustExist |
                    FileOpenOptions.DontAddToRecent
                );
                dialog.SetFileTypes(
                    1,
                    new FilterSpec[]
                    {
                        new FilterSpec
                        {
                            Name = "Instruction files (AGENTS.md, CLAUDE.md)",
                            Spec = "AGENTS.md;CLAUDE.md"
                        }
                    }
                );
                dialog.SetFileTypeIndex(1);
                dialog.SetTitle("Select the project instruction file");
                dialog.SetOkButtonLabel("Select this file");
                dialog.SetFileNameLabel("File:");

                int result = dialog.Show(IntPtr.Zero);

                if (result == Cancelled)
                {
                    return null;
                }

                Marshal.ThrowExceptionForHR(result);
                dialog.GetResult(out selectedItem);
                selectedItem.GetDisplayName(
                    ShellItemDisplayName.FileSystemPath,
                    out selectedPathPointer
                );

                return Marshal.PtrToStringUni(selectedPathPointer);
            }
            finally
            {
                if (selectedPathPointer != IntPtr.Zero)
                {
                    Marshal.FreeCoTaskMem(selectedPathPointer);
                }

                if (selectedItem != null)
                {
                    Marshal.FinalReleaseComObject(selectedItem);
                }

                Marshal.FinalReleaseComObject(dialog);
            }
        }
    }
}
'@

$selectedFile = [Cortex.Windows.InstructionsFilePicker]::SelectFile()

if ($null -ne $selectedFile) {
  [Console]::Write($selectedFile)
}
`;

export class DirectoryPickerService {
  async selectProjectDirectoryFromInstructionsFile(): Promise<string | null> {
    if (process.platform !== "win32") {
      throw new Error("The native file picker is available only on Windows.");
    }

    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-STA", "-Command", WINDOWS_INSTRUCTIONS_FILE_PICKER_SCRIPT],
      {
        encoding: "utf8",
        windowsHide: true
      }
    );

    const selectedFilePath = stdout.trim();

    if (!selectedFilePath) {
      return null;
    }

    const selectedFileName = path.basename(selectedFilePath).toUpperCase();

    if (selectedFileName !== "AGENTS.MD" && selectedFileName !== "CLAUDE.MD") {
      throw new Error(
        "The selected file must be named AGENTS.md or CLAUDE.md."
      );
    }

    return path.dirname(selectedFilePath);
  }
}
