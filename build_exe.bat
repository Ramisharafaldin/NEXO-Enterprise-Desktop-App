@echo off
title NEXO - Build Standalone Windows Executable
color 0B
cd /d "%~dp0"

echo ===============================================================================
echo                NEXO - STANDALONE EXECUTABLE BUILDER (PyInstaller)
echo ===============================================================================
echo.

:: 1. Check PyInstaller
pip show pyinstaller >nul 2>&1
if %errorlevel% neq 0 (
    echo [1/3] Installing PyInstaller...
    pip install pyinstaller
) else (
    echo [1/3] PyInstaller verified.
)

:: 2. Ensure frontend is built
echo [2/3] Building production frontend bundle (npm run build)...
call npm run build

:: 3. Build executable
echo [3/3] Packaging NEXO Desktop Application...
pyinstaller --noconfirm --onedir --windowed ^
    --name "NEXO" ^
    --icon "public\nexo.ico" ^
    --add-data "dist;dist" ^
    --add-data "backend;backend" ^
    --add-data "public;public" ^
    --hidden-import "uvicorn" ^
    --hidden-import "fastapi" ^
    --hidden-import "duckdb" ^
    --hidden-import "pyodbc" ^
    --hidden-import "pandas" ^
    --hidden-import "openpyxl" ^
    --hidden-import "webview" ^
    desktop_app.py

echo.
echo ===============================================================================
echo   Build complete! Output located at: dist\NEXO\NEXO.exe
echo ===============================================================================
pause
