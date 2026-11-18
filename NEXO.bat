@echo off
setlocal
cd /d "%~dp0"

set "PYW=%LOCALAPPDATA%\Programs\Python\Python311\pythonw.exe"
if not exist "%PYW%" set "PYW=pythonw.exe"

start "" "%PYW%" "%~dp0desktop_app.py"
exit /b 0
