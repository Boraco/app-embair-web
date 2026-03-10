@echo off
echo ===================================================
echo   VERIFICANDO REQUISITOS DEL SISTEMA
echo ===================================================
echo.

:: 1. Verificar si Node.js está instalado
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR CRITICO] NODE.JS NO ESTA INSTALADO.
    echo.
    echo Para que los bots funcionen, NECESITAS instalar Node.js primero.
    echo.
    echo ---------------------------------------------------
    echo   ABRIENDO PAGINA DE DESCARGA AUTOMATICAMENTE...
    echo ---------------------------------------------------
    echo.
    echo 1. Se abrira el navegador para descargar Node.js.
    echo 2. Descarga la version "LTS" (Recomendada).
    echo 3. Instalalo (dale "Siguiente" a todo).
    echo 4. Cuando termines, VUELVE A EJECUTAR ESTE ARCHIVO.
    echo.
    
    :: Abre la página de descarga oficial
    start https://nodejs.org/es/download/
    
    pause
    exit
)

echo [OK] Node.js detectado.
echo.
echo ===================================================
echo   INSTALANDO DEPENDENCIAS DEL BOT
echo ===================================================
echo.
echo [1/2] Instalando librerias de Node.js...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Hubo un problema instalando las librerias.
    pause
    exit /b
)

echo.
echo [2/2] Instalando librerias de Python (Panel)...
echo (Si no tienes Python instalado, este paso fallara pero los bots funcionaran igual)
pip install -r requirements.txt

echo.
echo ===================================================
echo   INSTALACION COMPLETADA EXITOSAMENTE
echo ===================================================
echo.
echo Ahora puedes ejecutar:
echo - iniciar_whatsapp.bat
echo - iniciar_marketplace.bat
echo - iniciar_bot.bat (Mercado Libre)
echo.
pause
