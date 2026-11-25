param([string] $ResumeRun)
$ErrorActionPreference = 'Stop'
$repo = 'ponder-j/aropyt-tauri'
$tag = 'v1.0.1'
$root = $PSScriptRoot
$directory = Join-Path $root 'publish'
$previous = Get-Content -LiteralPath (Join-Path $root 'previous-release/release.json') -Raw | ConvertFrom-Json
$releaseApi = "repos/$repo/releases/$($previous.id)"
$run = if ($ResumeRun) { $ResumeRun } else { 'pdf-links-20261125-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) }
if ($run -notmatch '^pdf-links-20261125-[a-f\d]{8}$') { throw 'Invalid publication staging name' }
$staging = Join-Path $root $run

function GitHub {
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        $response = & gh @args 2>&1
        $status = $LASTEXITCODE
        if ($status -eq 0) { return $response }
        $detail = ($response | Out-String).Trim()
        if ($args -contains 'DELETE' -and $detail -match 'HTTP 404') { return }
        if ($attempt -eq 5 -or $detail -notmatch 'timeout|temporarily|EOF|connection reset|HTTP (502|503|504)' -or $args -contains 'upload') {
            throw "GitHub command failed ($status): $($args[0]) $($args[1]) $detail"
        }
        Write-Host "Retrying $($args[0]) $($args[1]) after a transient GitHub connection error"
        Start-Sleep -Seconds $attempt
    }
}

function Get-Release {
    $response = GitHub api $releaseApi | ConvertFrom-Json
    $response.assets = @($response.assets | Where-Object { $_.name -notlike 'pdf-links-input-bb45f87--*' })
    return $response
}

function Rename-Asset([long] $id, [string] $name) {
    $response = GitHub api "repos/$repo/releases/assets/$id" --method PATCH -f "name=$name" | ConvertFrom-Json
    if ($response.name -cne $name) { throw "GitHub did not assign the requested asset name: $name" }
}

function Assert-Asset($asset, $file) {
    $digest = 'sha256:' + (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
    if (!$asset -or $asset.state -ne 'uploaded' -or $asset.digest -ne $digest -or $asset.size -ne $file.Length) {
        throw "Release digest mismatch for $($file.Name)"
    }
}

$files = Get-ChildItem -LiteralPath $directory -File
$release = Get-Release
if ($release.id -ne $previous.id -or $release.tag_name -ne $tag -or $release.immutable -or $release.draft -or $release.body -cne $previous.body) {
    throw 'The release changed while the replacement was being prepared'
}
$existing = @{}
foreach ($asset in $release.assets) { $existing[$asset.name] = $asset }
$expectedCount = if ($ResumeRun) { $previous.assets.Count + $files.Count } else { $previous.assets.Count }
if ($existing.Count -ne $expectedCount) { throw 'The attachment list changed during preparation' }
foreach ($asset in $previous.assets) {
    if ($existing[$asset.name].id -ne $asset.id -or $existing[$asset.name].digest -ne $asset.digest) { throw "Original attachment changed: $($asset.name)" }
}

if (!$ResumeRun) { New-Item -ItemType Directory -Path $staging | Out-Null }
$staged = @{}
$uploads = foreach ($file in $files) {
    $name = if ($file.Name -in $previous.assets.name) { "$run--$($file.Name)" } else { $file.Name }
    $copy = Join-Path $staging $name
    if (!$ResumeRun) { Copy-Item -LiteralPath $file.FullName -Destination $copy }
    $staged[$file.Name] = @{ name = $name; file = $file }
    $copy
}
if ($staged.Count -ne 13) { throw 'Unexpected replacement file count' }
if (!$ResumeRun) { GitHub release upload $tag --repo $repo @uploads }
$release = Get-Release
foreach ($entry in $staged.GetEnumerator()) {
    $asset = $release.assets | Where-Object name -CEQ $entry.Value.name
    Assert-Asset $asset $entry.Value.file
    $entry.Value.id = $asset.id
}

$order = (Get-Content -LiteralPath (Join-Path $root 'publication-plan.json') -Raw | ConvertFrom-Json).order
$switched = [System.Collections.Generic.List[string]]::new()
try {
    foreach ($name in $order) {
        $switched.Add($name)
        Rename-Asset $existing[$name].id "$run--previous--$name"
        Rename-Asset $staged[$name].id $name
    }
    $release = Get-Release
    foreach ($entry in $staged.GetEnumerator()) {
        $asset = $release.assets | Where-Object name -CEQ $entry.Key
        if ($asset.id -ne $entry.Value.id) { throw "Replacement ID mismatch for $($entry.Key)" }
        Assert-Asset $asset $entry.Value.file
    }
    GitHub release edit $tag --repo $repo --notes-file (Join-Path $root 'release-notes.md') | Out-Null
} catch {
    $failure = $_
    $release = Get-Release
    $currentNames = @{}
    foreach ($asset in $release.assets) { $currentNames[$asset.id] = $asset.name }
    for ($i = $switched.Count - 1; $i -ge 0; $i--) {
        $name = $switched[$i]
        if ($currentNames[$staged[$name].id] -ceq $name) { Rename-Asset $staged[$name].id $staged[$name].name }
        if ($currentNames[$existing[$name].id] -cne $name) { Rename-Asset $existing[$name].id $name }
    }
    throw $failure
}

# Keep backup attachments until every new name and all untouched attachments verify.
$release = Get-Release
foreach ($asset in $previous.assets) {
    if ($asset.name -notin $order) {
        $current = $release.assets | Where-Object name -CEQ $asset.name
        if ($current.id -ne $asset.id -or $current.digest -ne $asset.digest) { throw "Unrelated attachment changed: $($asset.name)" }
    }
}
foreach ($name in $order) {
    GitHub api "repos/$repo/releases/assets/$($existing[$name].id)" --method DELETE | Out-Null
}
$release = Get-Release
if ($release.assets.Count -ne ($previous.assets.Count + 2) -or $release.assets.name -like "$run--*") {
    throw 'Release attachment cleanup is incomplete'
}
foreach ($entry in $staged.GetEnumerator()) {
    Assert-Asset ($release.assets | Where-Object name -CEQ $entry.Key) $entry.Value.file
}
foreach ($asset in $release.assets | Sort-Object name) {
    Write-Output "$($asset.digest) $($asset.name)"
}
Write-Output $release.html_url
