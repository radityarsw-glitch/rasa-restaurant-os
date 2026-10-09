@echo off
rem ============================================================
rem  RASA - server senyap untuk Startup Windows
rem  Menyalakan server lokal saja (tanpa membuka browser).
rem  Dipasang otomatis oleh "Pasang Otomatis.bat".
rem ============================================================
cd /d "D:\Catatan ku\restaurant-os"

netstat -ano | findstr /C:":8787" | findstr /C:"LISTENING" >nul 2>&1
if not errorlevel 1 exit /b

start "RASA Server" /min cmd /c "python -m http.server 8787 --bind 127.0.0.1"
exit /b
