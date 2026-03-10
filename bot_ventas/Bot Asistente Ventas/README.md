# Mercado Libre Automation Bot

Este bot automatiza la gestión de preguntas y ventas en Mercado Libre utilizando Puppeteer para simular navegación humana y un archivo Excel local como inventario.

## Requisitos

- Node.js instalado
- Google Chrome instalado

## Instalación

1.  Abrir una terminal en la carpeta del proyecto.
2.  Ejecutar:
    ```bash
    npm install
    ```
    (Si usas PowerShell y tienes problemas, usa `npm.cmd install`)

## Configuración

1.  **Inventario**: Edita el archivo `inventario_ml.xlsx` con tus productos. Asegúrate de mantener las columnas: `Producto`, `Stock_Actual`, `Lote_Inicial`, `Precio`.
2.  **Credenciales**: (Opcional) Configura tus credenciales en el archivo `.env`. El bot usa persistencia de sesión, por lo que solo necesitas loguearte manualmente la primera vez.

## Ejecución

### Modo Normal (con ventana visible)
```bash
node ml_automation.js
```
La primera vez, se abrirá el navegador. **Inicia sesión manualmente en Mercado Libre**. El bot guardará tu sesión en la carpeta `user_data` y no te pedirá loguearte de nuevo en futuras ejecuciones.

### Modo Segundo Plano (PM2)
Para mantener el bot corriendo 24/7:

1.  Instala PM2 globalmente (si no lo tienes):
    ```bash
    npm install -g pm2
    ```
2.  Inicia el bot:
    ```bash
    pm2 start ml_automation.js --name "meli-bot"
    ```
3.  Para ver los logs:
    ```bash
    pm2 logs meli-bot
    ```
4.  Para detenerlo:
    ```bash
    pm2 stop meli-bot
    ```

## Personalización

El archivo `ml_automation.js` contiene la lógica principal. Deberás inspeccionar los elementos HTML de Mercado Libre y actualizar los selectores CSS en la sección de "Bucle infinito de monitoreo" para que el bot pueda encontrar y responder preguntas específicas, ya que Mercado Libre cambia sus clases CSS frecuentemente.
