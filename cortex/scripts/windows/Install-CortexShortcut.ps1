param([string]$InstallDirectory = '')

$ErrorActionPreference = 'Stop'
$cortexDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
if ([string]::IsNullOrWhiteSpace($InstallDirectory)) { $InstallDirectory = Join-Path $cortexDirectory 'data/desktop-launcher' }
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$npmCli = Join-Path (Split-Path -Parent $nodeExecutable) 'node_modules/npm/bin/npm-cli.js'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
foreach ($requiredFile in @($npmCli, $compiler)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) { throw "Fichier requis introuvable : $requiredFile" }
}
New-Item -ItemType Directory -Force -Path $InstallDirectory | Out-Null
$launcher = Join-Path $InstallDirectory 'Cortex.exe'
$source = Join-Path $PSScriptRoot 'CortexLauncher.cs'
$icon = Join-Path $cortexDirectory 'public/favicon.ico'
& $compiler /nologo /target:winexe /platform:anycpu "/out:$launcher" "/win32icon:$icon" /reference:System.Configuration.dll /reference:System.Windows.Forms.dll $source
if ($LASTEXITCODE -ne 0) { throw 'La compilation du lanceur Cortex a échoué.' }

$configuration = New-Object System.Xml.XmlDocument
$configuration.LoadXml('<configuration><appSettings /></configuration>')
foreach ($setting in @{
    WorkingDirectory = $cortexDirectory
    NodeExecutable = $nodeExecutable
    NpmCli = $npmCli
}.GetEnumerator()) {
    $entry = $configuration.CreateElement('add')
    $entry.SetAttribute('key', $setting.Key)
    $entry.SetAttribute('value', $setting.Value)
    [void]$configuration.SelectSingleNode('/configuration/appSettings').AppendChild($entry)
}
$configuration.Save("$launcher.config")

$programs = [Environment]::GetFolderPath('Programs')
$shortcutPath = Join-Path $programs 'Cortex.lnk'
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcut = $shortcutShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $cortexDirectory
$shortcut.IconLocation = "$launcher,0"
$shortcut.Description = 'Démarrer Cortex en local et ouvrir les chats et prompts'
$shortcut.WindowStyle = 7
$shortcut.Save()
[Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) | Out-Null
[Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcutShell) | Out-Null

[pscustomobject]@{ Launcher = $launcher; StartMenuShortcut = $shortcutPath; ApplicationUrl = 'http://127.0.0.1:3000/?mode=prompts' }
