@echo off
rem Pasang agar server RASA hidup setiap Windows menyala + pintasan di Desktop.
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

copy /y "%~dp0RASA Server Otomatis.bat" "%STARTUP%\RASA Server Otomatis.bat" >nul
if errorlevel 1 (
  echo Gagal memasang ke folder Startup.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell; $l=$w.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Buka RASA.lnk'); $l.TargetPath='D:\Catatan ku\restaurant-os\Buka RASA.bat'; $l.WorkingDirectory='D:\Catatan ku\restaurant-os'; $l.WindowStyle=7; $l.Description='Buka aplikasi RASA - Restaurant OS'; $l.Save()"

echo.
echo Berhasil dipasang:
echo   1. Server RASA otomatis jalan setiap Windows log masuk.
echo   2. Pintasan "Buka RASA" dibuat di Desktop untuk membuka situsnya.
echo.
echo Untuk melepas kembali, jalankan "Hapus Otomatis.bat".
pause
