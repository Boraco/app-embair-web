@echo off
echo Iniciando bots de automatizacion...
echo.
echo 1. WhatsApp Bot
start "Bot WhatsApp" cmd /k "node whatsapp_bot.js"

echo 2. Marketplace Bot
start "Bot Marketplace" cmd /k "node marketplace_bot.js"

echo 3. Mercado Libre Bot
start "Bot Mercado Libre" cmd /k "node ml_automation.js"

echo.
echo Todos los bots han sido iniciados en ventanas separadas.
echo Por favor revisa cada ventana para escanear codigos QR o verificar inicio de sesion.
pause
