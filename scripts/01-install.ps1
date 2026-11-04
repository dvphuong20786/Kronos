[CmdletBinding()]
param(
    [switch]$CpuOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Find-CompatiblePython {
    foreach ($version in @('3.11', '3.12', '3.10', '3.13', '3.14')) {
        & py "-$version" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == tuple(map(int, '$version'.split('.'))) else 1)" 2>$null
        if ($LASTEXITCODE -eq 0) {
            return @('py', "-$version")
        }
    }

    throw @"
Khong tim thay Python tuong thich. Hay cai Python 3.11 (khuyen nghi):
https://www.python.org/downloads/release/python-3119/

Sau khi cai, chay lai:
powershell -ExecutionPolicy Bypass -File .\scripts\01-install.ps1
"@
}

$pythonCommand = Find-CompatiblePython
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    Write-Host 'Tao moi truong ao .venv...'
    & $pythonCommand[0] $pythonCommand[1] -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Khong tao duoc .venv.' }
}

$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
Write-Host 'Nang cap pip...'
& $venvPython -m pip install --upgrade pip

if ($CpuOnly) {
    Write-Host 'Cai PyTorch ban CPU...'
    & $venvPython -m pip install 'torch>=2.0.0' --index-url https://download.pytorch.org/whl/cpu
}

Write-Host 'Cai dependencies cua model va Web UI...'
& $venvPython -m pip install -r requirements.txt -r webui\requirements.txt pytest
if ($LASTEXITCODE -ne 0) { throw 'Cai dependencies that bai.' }

New-Item -ItemType Directory -Path data -Force | Out-Null
Write-Host ''
Write-Host 'Cai dat hoan tat.' -ForegroundColor Green
Write-Host 'Buoc tiep theo: powershell -ExecutionPolicy Bypass -File .\scripts\02-build.ps1'

