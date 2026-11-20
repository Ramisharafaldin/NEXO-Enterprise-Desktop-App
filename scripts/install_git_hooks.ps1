$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoDir = Split-Path -Parent $scriptDir
$hooksDir = Join-Path $repoDir ".git\hooks"

if (-not (Test-Path $hooksDir)) {
    New-Item -ItemType Directory -Path $hooksDir -Force | Out-Null
}

$hookFile = Join-Path $hooksDir "pre-commit"
$hookContent = "#!/bin/sh`nif command -v python >/dev/null 2>&1; then`n  python scripts/bump_version.py --hook`nelif command -v py >/dev/null 2>&1; then`n  py scripts/bump_version.py --hook`nfi`n"

# Write strictly with LF line endings
$bytes = [System.Text.Encoding]::UTF8.GetBytes($hookContent)
[System.IO.File]::WriteAllBytes($hookFile, $bytes)

Write-Host "[NEXO] Git pre-commit hook installed successfully at $hookFile (LF line endings)."
