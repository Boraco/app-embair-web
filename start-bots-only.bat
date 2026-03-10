@echo off
echo ==========================================
echo    INICIANDO SOLO BOTS (Modo Hibrido/Remoto)
echo ==========================================
echo.
echo NOTA: Asegurate de haber configurado el archivo .env
echo en la carpeta 'bot_ventas/Bot Asistente Ventas' con la IP de tu VPS.
echo.

cd "bot_ventas/Bot Asistente Ventas"

echo 1. Iniciando Bot de WhatsApp...
start "WhatsApp Bot" cmd /k "node whatsapp_bot.js"

timeout /t 3

echo 2. Iniciando Bot de Marketplace...
start "Marketplace Bot" cmd /k "node marketplace_bot.js"

echo ==========================================
echo    BOTS INICIADOS
echo ==========================================
echo - Los bots se conectaran al servidor configurado en .env
echo - Mantener esta ventana o las ventanas de los bots abiertas.
pause