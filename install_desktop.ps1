$baseDir = $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$desktop\NEXO.lnk")
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"$baseDir\NEXO.vbs`""
$Shortcut.WorkingDirectory = $baseDir
$Shortcut.IconLocation = "$baseDir\public\nexo.ico"
$Shortcut.Description = "NEXO Enterprise Demand & Supply Chain Planning"
$Shortcut.Save()
Write-Host "Shortcut created!" -ForegroundColor Green
