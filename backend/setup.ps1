param(
  [string]$Python = "",
  [switch]$Gpu
)

$ErrorActionPreference = "Stop"
$BackendDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDirectory = Split-Path -Parent $BackendDirectory
$VirtualEnvironment = Join-Path $BackendDirectory ".venv"

function Resolve-Python {
  if ($Python) {
    return @{ File = $Python; Args = @() }
  }

  $PyLauncher = Get-Command "py" -ErrorAction SilentlyContinue
  if ($PyLauncher) {
    return @{ File = "py"; Args = @("-3") }
  }

  $PythonCommand = Get-Command "python" -ErrorAction SilentlyContinue
  if ($PythonCommand) {
    return @{ File = "python"; Args = @() }
  }

  throw "Python 3.10-3.12 was not found. Install Python, or pass -Python C:\Path\To\python.exe."
}

$PythonCommand = Resolve-Python
& $PythonCommand.File @($PythonCommand.Args) -m venv $VirtualEnvironment
& (Join-Path $VirtualEnvironment "Scripts\python.exe") -m pip install --upgrade pip
$Requirements = if ($Gpu) { "requirements-gpu.txt" } else { "requirements.txt" }
& (Join-Path $VirtualEnvironment "Scripts\python.exe") -m pip install -r (Join-Path $BackendDirectory $Requirements)

Write-Host "Lingua Live backend is ready in $VirtualEnvironment"
