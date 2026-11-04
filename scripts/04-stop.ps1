[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 7071
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue

if (-not $connections) {
    Write-Host "Khong co server nao dang lang nghe port $Port."
    exit 0
}

foreach ($connection in $connections) {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)"
    $commandLine = [string]$processInfo.CommandLine
    if ($commandLine -notlike "*$projectRoot*" -and $commandLine -notmatch 'python(.exe)?"?\s+app\.py') {
        throw "Port $Port do tien trinh khac su dung (PID $($connection.OwningProcess)). Script se khong dung tien trinh nay."
    }

    Stop-Process -Id $connection.OwningProcess
    Write-Host "Da dung Kronos Web UI (PID $($connection.OwningProcess), port $Port)." -ForegroundColor Green
}

