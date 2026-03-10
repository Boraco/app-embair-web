require('dotenv').config();
const puppeteer = require('puppeteer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const USER_DATA_DIR = './user_data';
const EXCEL_FILE = 'inventario_ml.xlsx';

async function importInventory() {
    console.log('Iniciando importación de inventario desde Mercado Libre...');
    
    const browser = await puppeteer.launch({
        headless: false,
        userDataDir: USER_DATA_DIR,
        defaultViewport: null,
        args: ['--start-maximized']
    });

    const page = await browser.newPage();
    
    // Ir a la lista de publicaciones
    console.log('Navegando a Publicaciones...');
    await page.goto('https://www.mercadolibre.com.ve/publicaciones/listado', { waitUntil: 'networkidle2' });

    console.log('\n--- IMPORTANTE ---');
    console.log('Por favor, verifica en la ventana de Chrome que estés logueado y viendo tu lista de publicaciones.');
    console.log('Si necesitas iniciar sesión, hazlo ahora.');
    console.log('Cuando veas la lista de productos, PRESIONA ENTER en esta ventana negra para continuar...');
    
    // Esperar enter del usuario
    await new Promise(resolve => process.stdin.once('data', resolve));

    console.log('Extrayendo datos de la página actual...');

    // Lógica de extracción (Intento de ser genérico para adaptarse a cambios de ML)
    const items = await page.evaluate(() => {
        const products = [];
        // Intentar identificar filas de productos
        // Usualmente en el listado de publicaciones hay filas con info
        const rows = document.querySelectorAll('li[class*="item-row"], div[class*="row-content"], tr');

        rows.forEach(row => {
            // Título
            const titleEl = row.querySelector('a[class*="title"], span[class*="title"], p[class*="title"]');
            const title = titleEl ? titleEl.innerText.trim() : null;

            // Precio
            const priceEl = row.querySelector('[class*="price"] span[class*="number"], [class*="price"]');
            const priceText = priceEl ? priceEl.innerText.replace(/\D/g, '') : '0';
            
            // Stock
            // A veces dice "50 disponibles" o es una columna específica
            const stockEl = row.querySelector('[class*="stock"], [class*="quantity"]');
            let stock = 0;
            if (stockEl) {
                const text = stockEl.innerText.toLowerCase();
                const match = text.match(/(\d+)/);
                if (match) stock = parseInt(match[1]);
            } else {
                // Fallback: Si no se ve, asumir 0 o 1
                stock = 1;
            }

            if (title) {
                products.push({
                    Producto: title,
                    Stock_Actual: stock,
                    Lote_Inicial: stock, // Asumimos que el stock actual es el lote inicial por ahora
                    Precio: parseInt(priceText) || 0
                });
            }
        });
        return products;
    });

    console.log(`Se encontraron ${items.length} publicaciones en esta página.`);
    
    if (items.length > 0) {
        // Crear o actualizar Excel
        const ws = XLSX.utils.json_to_sheet(items);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Inventario");
        XLSX.writeFile(wb, EXCEL_FILE);
        console.log(`¡Inventario exportado a ${EXCEL_FILE} exitosamente!`);
    } else {
        console.log('No se pudieron extraer productos automáticamente. Puede que la estructura de la página haya cambiado.');
    }

    console.log('Cerrando navegador en 10 segundos...');
    await new Promise(r => setTimeout(r, 10000));
    await browser.close();
}

importInventory();