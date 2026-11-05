[CmdletBinding()]
param(
    [switch]$FullRegression
)

$ErrorActionPreference = 'Stop'
$env:PYTHONDONTWRITEBYTECODE = '1'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw 'Chua co .venv. Hay chay .\scripts\01-install.ps1 truoc.'
}

Write-Host 'Kiem tra import...'
& $venvPython -c "import flask, flask_cors, pandas, numpy, plotly, torch, einops, huggingface_hub, safetensors; from model import Kronos, KronosTokenizer, KronosPredictor; print('Imports OK'); print('PyTorch:', torch.__version__); print('CUDA:', torch.cuda.is_available())"
if ($LASTEXITCODE -ne 0) { throw 'Kiem tra import that bai.' }

Write-Host 'Kiem tra cu phap ma khong tao .pyc...'
& $venvPython -c "import ast, pathlib; roots=['model','webui','examples','scripts']; files=[p for r in roots for p in pathlib.Path(r).rglob('*.py')]; [ast.parse(p.read_text(encoding='utf-8-sig'), filename=str(p)) for p in files]; print(f'Syntax OK: {len(files)} Python files')"
if ($LASTEXITCODE -ne 0) { throw 'Syntax check that bai.' }

Write-Host 'Kiem tra Flask API bang test client...'
& $venvPython -c "import sys; sys.path.insert(0, 'webui'); from app import app; c=app.test_client(); assert c.get('/').status_code == 200; assert c.get('/api/model-status').status_code == 200; assert c.get('/api/available-models').status_code == 200; assert c.get('/api/data-files').status_code == 200; print('Web API smoke test OK')"
if ($LASTEXITCODE -ne 0) { throw 'Web API smoke test that bai.' }

Write-Host 'Kiem tra pytest co the thu thap test...'
& $venvPython -m pytest tests --collect-only -q
if ($LASTEXITCODE -ne 0) { throw 'Pytest collection that bai.' }

if ($FullRegression) {
    Write-Host 'Chay full regression (tai model va co the rat lau tren CPU)...'
    & $venvPython -m pytest tests -q
    if ($LASTEXITCODE -ne 0) { throw 'Full regression test that bai.' }
}

Write-Host ''
Write-Host 'Build/check hoan tat.' -ForegroundColor Green
if (-not $FullRegression) {
    Write-Host 'Full regression da bo qua. Tuy chon: .\scripts\02-build.ps1 -FullRegression'
}
Write-Host 'Buoc tiep theo: powershell -ExecutionPolicy Bypass -File .\scripts\03-run.ps1'

