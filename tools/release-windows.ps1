$ErrorActionPreference = 'Stop'
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    $taskSigningKey = Join-Path $env:USERPROFILE '.tauri/aropyt-updater.key'
    if (-not (Test-Path -LiteralPath $taskSigningKey)) { throw 'Set TAURI_SIGNING_PRIVATE_KEY to the existing updater signing key' }
    $env:TAURI_SIGNING_PRIVATE_KEY = $taskSigningKey
}
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
node --test tools/updates-test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node tools/tauri.mjs build --bundles nsis --ci -- --locked
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$taskReleaseVersion = (Get-Content -Raw package.json | ConvertFrom-Json).version
$installers = @(Get-Item -LiteralPath "src-tauri/target/release/bundle/nsis/Aropyt_${taskReleaseVersion}_x64-setup.exe")
if ($installers.Count -ne 1) { throw 'Expected exactly one Windows x64 installer' }
$installer = $installers[0]
& (Join-Path $PSScriptRoot 'verify-windows-installer.ps1') -Installer $installer.FullName
Copy-Item -LiteralPath $installer.FullName -Destination release/artifacts/
Copy-Item -LiteralPath ($installer.FullName + '.sig') -Destination release/artifacts/
node tools/updater-manifest.mjs
if ($LASTEXITCODE -ne 0) { throw 'Updater manifest generation failed' }
