const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
require('dotenv').config();

// Configuración API Backend (App Ecomerce)
const API_HOST = process.env.API_HOST || 'localhost';
const API_PORT = process.env.API_PORT || 3002;
const API_PROTOCOL = process.env.API_PROTOCOL || 'http'; // http o https
const requestModule = API_PROTOCOL === 'https' ? https : http;

const USER_DATA_DIR = './marketplace_session'; // Carpeta para guardar sesión
const MARKETPLACE_URL = 'https://www.facebook.com/messages/t/'; // Bandeja de entrada

// =========================================================
// INTEGRACIÓN CON API CENTRAL
// =========================================================

function sendToWebhook(pageUrl, productText, pageTitle) {
    // Intentar extraer ID del chat de la URL
    const parts = pageUrl.split('/');
    let remoteId = parts[parts.length - 1] === '' ? parts[parts.length - 2] : parts[parts.length - 1];
    
    if (!remoteId || remoteId === 't') return;

    const data = JSON.stringify({
        platform: 'marketplace',
        remote_id: remoteId,
        sender_name: pageTitle || "Usuario Marketplace",
        content: `Interés detectado en: ${productText}`,
        timestamp: new Date().toISOString()
    });

    const options = {
        hostname: API_HOST,
        port: API_PROTOCOL === 'https' ? 443 : API_PORT,
        path: '/api/chat/webhook',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    const req = requestModule.request(options, res => {});
    req.on('error', e => console.error('Error enviando webhook Marketplace:', e));
    req.write(data);
    req.end();
}

function pollPendingReplies() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: API_HOST,
            port: API_PROTOCOL === 'https' ? 443 : API_PORT,
            path: '/api/chat/pending-replies/marketplace',
            method: 'GET'
        };

        const req = requestModule.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const messages = JSON.parse(data);
                        resolve(messages);
                    } catch (e) {
                        resolve([]);
                    }
                } else {
                    resolve([]);
                }
            });
        });

        req.on('error', (e) => {
            resolve([]);
        });
        req.end();
    });
}

// =========================================================
// LÓGICA DE INVENTARIO (Desde products.json)
// =========================================================
function getInventory() {
    // Buscar products.json en la estructura del proyecto
    // Asumimos que estamos en: bot_ventas/Bot Asistente Ventas/
    // products.json está en: data/products.json (en la raíz del proyecto)
    const productsFile = path.join(__dirname, '..', '..', 'data', 'products.json');
    
    if (!fs.existsSync(productsFile)) {
        console.error("No se encontró products.json en:", productsFile);
        return [];
    }

    try {
        const raw = fs.readFileSync(productsFile, 'utf-8');
        const products = JSON.parse(raw);
        
        // Mapear al formato esperado por el bot
        return products.map(p => ({
            producto: p.name,
            stock: p.stock || 0, // Asumiendo campo 'stock' o 'available'
            precio: p.price,
            datos_tecnicos: p.description || "",
            categoria: p.category || "General"
        }));
    } catch (e) {
        console.error("Error leyendo inventario:", e);
        return [];
    }
}

// =========================================================
// BOT DE MARKETPLACE (Facebook Messenger)
// =========================================================
async function startMarketplaceBot() {
    console.log("🚀 Iniciando Bot de Marketplace (Integrado con App Ecomerce)...");
    
    // Cargar inventario al inicio
    const inventory = getInventory();
    console.log(`📦 Inventario cargado: ${inventory.length} productos desde sistema central.`);

    const browser = await puppeteer.launch({
        headless: false, 
        userDataDir: USER_DATA_DIR,
        defaultViewport: null,
        args: [
            '--start-maximized', 
            '--disable-notifications',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-accelerated-2d-canvas'
        ]
    });

    const page = await browser.newPage();
    await page.goto(MARKETPLACE_URL, { waitUntil: 'networkidle2' });

    console.log("\n⚠️ ATENCIÓN:");
    console.log("1. Si no has iniciado sesión en Facebook, hazlo manualmente en la ventana que se abrió.");
    console.log("2. El bot monitoreará tus chats y conectará con el sistema central.");
    console.log("3. NO cierres la ventana del navegador controlada por el bot.\n");

    // Bucle de monitoreo unificado (cada 10 segundos)
    setInterval(async () => {
        try {
            // -------------------------------------------------
            // 1. REVISAR RESPUESTAS PENDIENTES (Desde Dashboard)
            // -------------------------------------------------
            const pendingReplies = await pollPendingReplies();
            
            if (pendingReplies && pendingReplies.length > 0) {
                console.log(`📨 Encontradas ${pendingReplies.length} respuestas pendientes.`);
                
                for (const reply of pendingReplies) {
                    const remoteId = reply.lead.remote_id;
                    const content = reply.content;
                    
                    console.log(`   -> Enviando a ${remoteId}: "${content}"`);
                    
                    // Navegar al chat específico
                    const currentUrl = page.url();
                    if (!currentUrl.includes(remoteId)) {
                        await page.goto(`${MARKETPLACE_URL}${remoteId}`, { waitUntil: 'networkidle2' });
                        await new Promise(r => setTimeout(r, 2000));
                    }
                    
                    try {
                        const inputSelector = 'div[aria-label="Mensaje"], div[role="textbox"], div[contenteditable="true"]';
                        await page.waitForSelector(inputSelector, { timeout: 5000 });
                        await page.focus(inputSelector);
                        await page.keyboard.type(content);
                        await page.keyboard.press('Enter');
                        console.log(`   ✅ Enviado a ${remoteId}`);
                    } catch (err) {
                        console.error(`   ❌ Error enviando a ${remoteId}:`, err.message);
                    }
                }
            }

            // -------------------------------------------------
            // 2. DETECCIÓN DE CONTEXTO (Producto en pantalla)
            // -------------------------------------------------
            const pageText = await page.evaluate(() => document.body.innerText);
            
            let foundProduct = null;
            // Ordenar por longitud para coincidencia más específica
            const sortedInventory = inventory.sort((a, b) => b.producto.length - a.producto.length);

            for (const item of sortedInventory) {
                if (pageText.includes(item.producto)) {
                    foundProduct = item;
                    break; 
                }
            }

            if (foundProduct) {
                // Notificar al Dashboard que estamos viendo este producto
                const currentUrl = page.url();
                const pageTitle = await page.title();
                
                // Enviamos webhook (solo log, sin spam)
                // Podríamos agregar lógica para no enviar repetidamente el mismo
                sendToWebhook(currentUrl, foundProduct.producto, pageTitle);
            }

        } catch (e) {
            // Ignorar errores transitorios
        }
    }, 10000); 
}

startMarketplaceBot();
