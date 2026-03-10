@echo off
echo Iniciando Panel de Control (Bot Asistente de Ventas)...
echo.
echo Abre tu navegador en: http://localhost:8000
echo.
echo NOTA: No olvides ejecutar 'iniciar_bots.bat' para conectar tus bots.
echo.
".\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Ocurrio un error al iniciar el servidor.
    echo Revisa los mensajes de error arriba.
    pause
)
pause