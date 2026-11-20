$baseDir = $PSScriptRoot
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$py = @((Get-Command python -ErrorAction SilentlyContinue).Source, (Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python*\python.exe","C:\Python*\python.exe","C:\Program Files\Python*\python.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $py) { throw "Python executable not found." }
$pyw = Join-Path (Split-Path $py) "pythonw.exe"
if (-not (Test-Path $pyw)) { $pyw = $py }
$ws = New-Object -ComObject WScript.Shell
$desktops = @([Environment]::GetFolderPath("Desktop"), "$env:USERPROFILE\Desktop") | Select-Object -Unique
foreach ($desk in $desktops) { if (Test-Path $desk) { $s = $ws.CreateShortcut("$desk\NEXO.lnk"); $s.TargetPath = $pyw; $s.Arguments = "`"$baseDir\desktop_app.py`""; $s.WorkingDirectory = $baseDir; $s.IconLocation = "$baseDir\public\nexo.ico"; $s.Description = "NEXO Enterprise Demand & Supply Chain Planning"; $s.Save() } }
Write-Host "NEXO Desktop Shortcut configured -> $pyw" -ForegroundColor Green
