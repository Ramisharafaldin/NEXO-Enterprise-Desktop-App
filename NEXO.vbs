Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = baseDir
WshShell.Run "pythonw.exe """ & baseDir & "\desktop_app.py""", 0, False
