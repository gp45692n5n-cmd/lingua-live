param(
  [string]$Python = ""
)

$ErrorActionPreference = "Stop"
$BackendDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$VirtualEnvironmentPython = Join-Path $BackendDirectory ".venv\Scripts\python.exe"

if (-not $Python -and (Test-Path $VirtualEnvironmentPython)) {
  $Python = $VirtualEnvironmentPython
}

if (-not $Python) {
  $PyLauncher = Get-Command "py" -ErrorAction SilentlyContinue
  if ($PyLauncher) {
    & py -3 -m py_compile (Join-Path $BackendDirectory "server.py")
    exit $LASTEXITCODE
  }
}

if (-not $Python) {
  $PythonCommand = Get-Command "python" -ErrorAction SilentlyContinue
  if ($PythonCommand) {
    $Python = "python"
  }
}

if (-not $Python) {
  throw "Python was not found. Run backend/setup.ps1 first, or pass -Python C:\Path\To\python.exe."
}

& $Python -m py_compile (Join-Path $BackendDirectory "server.py")
