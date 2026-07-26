param(
  [string]$Python = "python",
  [switch]$Gpu
)

$ErrorActionPreference = "Stop"
$BackendDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDirectory = Split-Path -Parent $BackendDirectory
$VirtualEnvironment = Join-Path $BackendDirectory ".venv"

& $Python -m venv $VirtualEnvironment
& (Join-Path $VirtualEnvironment "Scripts\python.exe") -m pip install --upgrade pip
$Requirements = if ($Gpu) { "requirements-gpu.txt" } else { "requirements.txt" }
& (Join-Path $VirtualEnvironment "Scripts\python.exe") -m pip install -r (Join-Path $BackendDirectory $Requirements)

Write-Host "Lingua Live backend is ready in $VirtualEnvironment"
