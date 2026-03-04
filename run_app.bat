@echo off
setlocal

cd /d "%~dp0"

set "APP_URL=http://127.0.0.1:8000"

where uv >nul 2>nul
if errorlevel 1 (
    echo [ERROR] uv is not installed or not on PATH.
    echo Install uv, then run: uv sync
    exit /b 1
)

start "" powershell -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process '%APP_URL%'"

uv run python main.py --reload
