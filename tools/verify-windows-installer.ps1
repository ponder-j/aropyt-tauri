param([Parameter(Mandatory=$true)][string]$Installer, [switch]$InstallUpdate, [switch]$SkipApplicationTests)
$ErrorActionPreference = 'Stop'
$installerFile = Get-Item -LiteralPath $Installer
$installDirectory = Join-Path ([IO.Path]::GetTempPath()) ('aropyt-release-' + [Guid]::NewGuid().ToString('N'))
$registryBackup = Join-Path $installDirectory 'registry-backup'
New-Item -ItemType Directory -Path $registryBackup -Force | Out-Null
# NSIS uses per-user registrations even with /D pointing to a temporary folder.
# Preserve this host's app registration and file associations around the test.
$keys = @('Software\aropyt\Aropyt', 'Software\Microsoft\Windows\CurrentVersion\Uninstall\Aropyt', 'Software\Classes\Markdown Document')
$config = Get-Content -Raw src-tauri/tauri.conf.json | ConvertFrom-Json
foreach ($extension in $config.bundle.fileAssociations[0].ext) { $keys += 'Software\Classes\.' + $extension }
$backups = @()
foreach ($key in $keys) {
    $file = Join-Path $registryBackup ($backups.Count.ToString() + '.reg')
    $existed = Test-Path -LiteralPath ('Registry::HKEY_CURRENT_USER\' + $key)
    if ($existed) { & reg.exe export ('HKCU\' + $key) $file /y | Out-Null; if ($LASTEXITCODE -ne 0) { throw "Cannot back up $key" } }
    $backups += @{key=$key; file=$file; existed=$existed}
}
try {
    $process = Start-Process -FilePath $installerFile.FullName -ArgumentList @('/S','/UPDATE','/NS',('/D=' + $installDirectory)) -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
    $binary = Join-Path $installDirectory 'aropyt.exe'
    if (-not $SkipApplicationTests) {
        node tools/verify-packaged.mjs windows-x64 $binary $installerFile.FullName
        if ($LASTEXITCODE -ne 0) { throw 'Installed Windows application regression failed' }
    }
    $updateArgs = @('tools/test-updater.mjs', $binary, $installerFile.FullName)
    if ($InstallUpdate) { $updateArgs += '--install' }
    node @updateArgs
    if ($LASTEXITCODE -ne 0) { throw 'Native updater regression failed' }
} finally {
    foreach ($backup in $backups) {
        $registryPath = 'Registry::HKEY_CURRENT_USER\' + $backup.key
        if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath -Recurse -Force }
        if ($backup.existed) { & reg.exe import $backup.file *> $null; if ($LASTEXITCODE -ne 0) { throw 'Registry restore failed; backups remain at ' + $registryBackup } }
    }
    # No uninstaller: it could remove this host's existing app shortcuts/profile.
    $resolved = [IO.Path]::GetFullPath($installDirectory)
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notlike 'aropyt-release-*') { throw 'Unexpected test installation directory' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
