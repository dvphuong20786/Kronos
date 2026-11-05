[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [ValidateRange(1, 65535)]
    [int]$Port = 7071
)

$ErrorActionPreference = 'Stop'
$env:PYTHONDONTWRITEBYTECODE = '1'
$savedAlphaKey = [Environment]::GetEnvironmentVariable('ALPHAVANTAGE_API_KEY', 'User')
if ($savedAlphaKey) {
    $env:ALPHAVANTAGE_API_KEY = $savedAlphaKey
}
$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw 'Chua co .venv. Hay chay .\scripts\01-install.ps1 truoc.'
}

New-Item -ItemType Directory -Path (Join-Path $projectRoot 'data') -Force | Out-Null
Set-Location -LiteralPath (Join-Path $projectRoot 'webui')

$env:KRONOS_PORT = $Port
Write-Host "Kronos Web UI: http://localhost:$Port" -ForegroundColor Cyan
Write-Host "Health/model status: http://localhost:$Port/api/model-status"
Write-Host "Danh sach model: http://localhost:$Port/api/available-models"
Write-Host "Danh sach data: http://localhost:$Port/api/data-files"
Write-Host 'Nhan Ctrl+C de dung.'

if (-not $NoBrowser) {
    Start-Process "http://localhost:$Port"
}

& $venvPython app.py

