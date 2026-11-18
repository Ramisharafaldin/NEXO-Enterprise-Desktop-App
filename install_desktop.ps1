$baseDir = $PSScriptRoot
$pyw = (python -c "import sys, os; p = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe'); print(p if os.path.exists(p) else sys.executable)").Trim()
$ws = New-Object -ComObject WScript.Shell
$desktops = @([Environment]::GetFolderPath("Desktop"), "$env:USERPROFILE\Desktop") | Select-Object -Unique
foreach ($desk in $desktops) { if (Test-Path $desk) { $s = $ws.CreateShortcut("$desk\NEXO.lnk"); $s.TargetPath = $pyw; $s.Arguments = "`"$baseDir\desktop_app.py`""; $s.WorkingDirectory = $baseDir; $s.IconLocation = "$baseDir\public\nexo.ico"; $s.Description = "NEXO Enterprise Demand & Supply Chain Planning"; $s.Save() } }
Write-Host "NEXO Desktop Shortcut configured!" -ForegroundColor Green
