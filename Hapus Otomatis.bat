@echo off
rem Lepas pemasangan: hapus dari Startup dan hapus pintasan Desktop.
del /f /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\RASA Server Otomatis.bat" >nul 2>&1
del /f /q "%USERPROFILE%\Desktop\Buka RASA.lnk" >nul 2>&1

echo Pemasangan otomatis RASA sudah dilepas.
echo Server yang sedang berjalan akan berhenti saat komputer dimatikan.
pause
