@echo off
title NEXO - Enterprise Demand and Supply Chain Planning
color 0B
cd /d "%~dp0"

echo ===============================================================================
echo                NEXO - ENTERPRISE SUPPLY CHAIN PLANNING PLATFORM
echo                    Native Windows Desktop Application
echo ===============================================================================
echo.

:: Check Python installation
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python 3 is not found in your system PATH!
    echo Please install Python 3.10+ from https://www.python.org/
    pause
    exit /b 1
)

:: Launch the native desktop application (Edge WebView2)
echo Starting NEXO Native Desktop Application...
python desktop_app.py

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Application exited with code: %errorlevel%
    pause
)
