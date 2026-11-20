@echo off
cd /d "%~dp0"
echo [1/4] Checking Python runtime...
where python >nul 2>nul || winget install -e --id Python.Python.3.11 --accept-package-agreements --accept-source-agreements
echo [2/4] Checking Node.js runtime...
where node >nul 2>nul || winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'); $py = (Get-Command python -ErrorAction SilentlyContinue).Source; if (-not $py) { $py = (Get-ChildItem '$env:LOCALAPPDATA\Programs\Python\Python*\python.exe','C:\Python*\python.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName }; & $py -m pip install -r requirements.txt; npm install; npm run build; & '$PSScriptRoot\install_desktop.ps1'"
echo Setup complete! Launch NEXO from your Desktop shortcut.
