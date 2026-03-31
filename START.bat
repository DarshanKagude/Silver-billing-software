@echo off
title Silver Jewellery Billing — Unified Server
echo.
echo  ======================================================
echo   Silver Jewellery Billing Software (Unified)
echo  ======================================================
echo.
echo  This launcher starts both the Billing UI and the Sync API
echo  on a single port (8000) using FastAPI.
echo.

:: Check for virtual environment
if not exist ".venv" (
    echo  [!] Virtual environment not found. Creating one...
    python -m venv .venv
    if %errorlevel% neq 0 (
        echo  [X] Failed to create virtual environment. Please ensure Python is installed.
        pause
        exit /b %errorlevel%
    )
    echo  [✓] Virtual environment created.
)

echo  [1/1] Starting Server on http://localhost:8000 ...
echo.
.\.venv\Scripts\python -m pip install -r backend\requirements.txt -q

echo  [!] Opening application in your default browser...
start "" "http://localhost:8000"

cd backend
..\.venv\Scripts\python main.py

if %errorlevel% neq 0 (
    echo.
    echo  [X] Server crashed or failed to start.
    pause
)
