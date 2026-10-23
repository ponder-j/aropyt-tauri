$ErrorActionPreference = 'Stop'
if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
    throw 'The Windows release requires an x64 runner'
}
New-Item -ItemType Directory -Force -Path release/artifacts,release/verification/windows-x64 | Out-Null
npm run typecheck
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node tools/test-platform.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node tools/wordcount-test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node tools/tauri.mjs build --bundles nsis --ci -- --locked
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$installers = @(Get-ChildItem src-tauri/target/release/bundle/nsis/*_x64-setup.exe)
if ($installers.Count -ne 1) { throw 'Expected exactly one Windows x64 installer' }
$installer = $installers[0]
$installDirectory = Join-Path ([IO.Path]::GetTempPath()) ('aropyt-release-' + [Guid]::NewGuid().ToString('N'))
try {
    $process = Start-Process -FilePath $installer.FullName -ArgumentList @('/S',('/D=' + $installDirectory)) -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
    $binary = Join-Path $installDirectory 'aropyt.exe'
    node tools/verify-packaged.mjs windows-x64 $binary $installer.FullName
    if ($LASTEXITCODE -ne 0) { throw 'Installed Windows application regression failed' }
    Copy-Item -LiteralPath $installer.FullName -Destination release/artifacts/
} finally {
    $uninstaller = Join-Path $installDirectory 'uninstall.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
        if ($process.ExitCode -ne 0) { throw "Uninstaller failed: $($process.ExitCode)" }
    }
}
