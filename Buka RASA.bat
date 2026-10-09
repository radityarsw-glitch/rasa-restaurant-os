@echo off
rem ============================================================
rem  RASA - Restaurant OS
rem  Jalankan server lokal, lalu buka situsnya di Google Chrome.
rem  Data (menu, pesanan, reservasi, pengaturan) tersimpan di
rem  Chrome profil yang sama, jadi selalu utuh saat dibuka lagi.
rem ============================================================
cd /d "%~dp0"

netstat -ano | findstr /C:":8787" | findstr /C:"LISTENING" >nul 2>&1
if not errorlevel 1 goto buka

echo Menjalankan server RASA (http://127.0.0.1:8787) ...
start "RASA Server" /min cmd /c "python -m http.server 8787 --bind 127.0.0.1"
timeout /t 2 >nul

:buka
set "URL=http://127.0.0.1:8787/index.html"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" "%URL%"
  goto selesai
)
set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" "%URL%"
  goto selesai
)
set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" "%URL%"
  goto selesai
)
start "" "%URL%"
:selesai
exit /b
