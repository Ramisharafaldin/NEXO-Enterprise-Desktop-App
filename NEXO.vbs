Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = baseDir
pyExe = "python.exe"
If fso.FileExists(baseDir & "\.python_exe.txt") Then pyExe = Trim(fso.OpenTextFile(baseDir & "\.python_exe.txt", 1).ReadAll)
pyExe = Replace(Replace(pyExe, vbCr, ""), vbLf, "")
WshShell.Run """" & pyExe & """ """ & baseDir & "\desktop_app.py""", 0, False
