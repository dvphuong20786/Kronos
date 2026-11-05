[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path

$sourceRoots = @('model', 'webui', 'examples', 'tests', 'scripts', 'finetune', 'finetune_csv') |
    ForEach-Object { Join-Path $projectRoot $_ } |
    Where-Object { Test-Path -LiteralPath $_ }

$cacheDirectories = @($sourceRoots | ForEach-Object {
    Get-ChildItem -LiteralPath $_ -Directory -Filter '__pycache__' -Recurse -Force
})
$pycFiles = @($sourceRoots | ForEach-Object {
    Get-ChildItem -LiteralPath $_ -File -Filter '*.pyc' -Recurse -Force
})

foreach ($file in $pycFiles) {
    $resolved = $file.FullName
    if (-not $resolved.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to delete outside project: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Force
}

foreach ($directory in ($cacheDirectories | Sort-Object { $_.FullName.Length } -Descending)) {
    $resolved = $directory.FullName
    if (-not $resolved.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to delete outside project: $resolved"
    }
    if (Test-Path -LiteralPath $resolved) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

Write-Host "Removed $($pycFiles.Count) .pyc files and $($cacheDirectories.Count) __pycache__ directories." -ForegroundColor Green
