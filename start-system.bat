@echo off
echo ==========================================
echo    INICIANDO SISTEMA INTEGRADO (APP + BOTS)
echo ==========================================

echo 1. Iniciando Servidor Principal (Puerto 3002)...
start "App Server" cmd /k "node server/index.js"

timeout /t 5

echo 2. Iniciando Bot de WhatsApp...
cd "bot_ventas/Bot Asistente Ventas"
start "WhatsApp Bot" cmd /k "node whatsapp_bot.js"

echo 3. Iniciando Bot de Marketplace...
start "Marketplace Bot" cmd /k "node marketplace_bot.js"

echo ==========================================
echo    TODO LISTO
echo ==========================================
echo - El servidor principal esta corriendo.
echo - Los bots se estan conectando en ventanas separadas.
echo - Escanea el codigo QR en la ventana de WhatsApp.
echo - Inicia sesion en Facebook en la ventana de Marketplace.
pause
