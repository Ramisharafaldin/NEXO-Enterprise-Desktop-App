Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = baseDir
localPy = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\Python\Python311\pythonw.exe"
If fso.FileExists(localPy) Then
  WshShell.Run """" & localPy & """ """ & baseDir & "\desktop_app.py""", 0, False
Else
  WshShell.Run "cmd /c start """" /min pythonw.exe """ & baseDir & "\desktop_app.py""", 0, False
End If
