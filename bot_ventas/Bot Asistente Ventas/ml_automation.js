require('dotenv').config();
const puppeteer = require('puppeteer');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Configuración API Backend
const API_HOST = 'localhost';
const API_PORT = 8000;

function calculateRemoteId(text) {
    const simpleHash = text.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a }, 0);
    return `ML_PREG_${Math.abs(simpleHash)}`;
}

function sendToWebhook(questionText, productTitle) {
    const remoteId = calculateRemoteId(questionText);

    const data = JSON.stringify({
        platform: 'mercadolibre',
        remote_id: remoteId,
        sender_name: "Usuario MercadoLibre",
        content: `Pregunta en ${productTitle}: ${questionText}`,
        timestamp: new Date().toISOString(),
        sender_type: 'user'
    });

    const options = {
        hostname: API_HOST,
        port: API_PORT,
        path: '/api/chat/webhook',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };

    const req = http.request(options, res => {
        // Log status to debug webhook issues
        if (res.statusCode !== 200) {
            console.error(`[ERROR] Webhook falló con status: ${res.statusCode}`);
            res.on('data', d => console.error(d.toString()));
        } else {
            console.log(`[OK] Webhook enviado correctamente (ID: ${remoteId})`);
        }
    });
    req.on('error', e => console.error('Error enviando webhook ML:', e));
    req.write(data);
    req.end();
}

function pollPendingReplies() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: API_HOST,
            port: API_PORT,
            path: '/api/chat/pending-replies/mercadolibre',
            method: 'GET'
        };

        const req = http.request(options, res => {
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
            // console.error('Error polling:', e);
            resolve([]);
        });
        req.end();
    });
}

// Configuración
const EXCEL_FILE = 'inventario_ml.xlsx';
const USER_DATA_DIR = './user_data';
const CHECK_INTERVAL_MIN = 3 * 60 * 1000; // 3 minutos
const CHECK_INTERVAL_MAX = 5 * 60 * 1000; // 5 minutos

// Utilidades
const delay = (time) => new Promise(resolve => setTimeout(resolve, time));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function logAction(action, details) {
    const timestamp = new Date().toLocaleString();
    console.log(`[${timestamp}] [${action}] ${details}`);
}

// Lógica de Inventario
function loadInventory() {
    try {
        const workbook = XLSX.readFile(EXCEL_FILE);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        return XLSX.utils.sheet_to_json(sheet);
    } catch (error) {
        logAction('ERROR', `No se pudo leer el archivo Excel: ${error.message}`);
        return [];
    }
}

function calculateAvailability(stockActual, loteInicial) {
    if (!loteInicial || loteInicial === 0) return 'Consultar disponibilidad';
    const percentage = (stockActual / loteInicial) * 100;
    
    if (percentage > 75) return 'Plena disponibilidad';
    if (percentage >= 25 && percentage <= 75) return 'Quedan pocas unidades';
    return '¡Últimas unidades disponibles!';
}

function findProduct(inventory, query) {
    if (!query) return null;
    const lowerQuery = query.toLowerCase();
    
    // 1. Búsqueda exacta (includes)
    let match = inventory.find(item => item.Producto && item.Producto.toLowerCase().includes(lowerQuery));
    if (match) return match;

    // 2. Búsqueda por palabras clave (si coinciden más del 50% de las palabras importantes)
    const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 3);
    
    match = inventory.find(item => {
        if (!item.Producto) return false;
        const itemLower = item.Producto.toLowerCase();
        const matches = queryWords.filter(word => itemLower.includes(word));
        return matches.length >= Math.ceil(queryWords.length * 0.5);
    });

    return match;
}

// Simulación Humana
async function humanType(page, selectorOrHandle, text) {
    if (typeof selectorOrHandle === 'string') {
        await page.waitForSelector(selectorOrHandle);
        await page.click(selectorOrHandle);
        for (const char of text) {
            await page.keyboard.type(char, { delay: randomDelay(50, 150) });
        }
    } else {
        // Es un ElementHandle
        await selectorOrHandle.focus();
        for (const char of text) {
            await page.keyboard.type(char, { delay: randomDelay(50, 150) });
        }
    }
}

async function getAIResponse(product, question) {
    if (!product) return null;

    try {
        const payload = {
            platform: "mercadolibre",
            product_name: product.Producto,
            question: question,
            product_info: product.Datos_Tecnicos || "", // Nueva columna en Excel
            price: product.Precio,
            stock: product.Stock_Actual
        };

        const options = {
            hostname: API_HOST,
            port: API_PORT,
            path: '/api/ai/analyze',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(JSON.stringify(payload))
            }
        };

        return new Promise((resolve) => {
            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const result = JSON.parse(data);
                            resolve(result);
                        } catch (e) {
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                });
            });
            req.on('error', (e) => resolve(null));
            req.write(JSON.stringify(payload));
            req.end();
        });

    } catch (e) {
        console.error("AI Error:", e);
        return null;
    }
}

// Lógica de Respuesta
async function generateResponse(product, questionText) {
    if (!product) {
        // NO responder automáticamente si no hay información del producto.
        return null;
    }

    // 1. Consultar a la "IA" (Backend) para determinar tipo de pregunta
    const aiAnalysis = await getAIResponse(product, questionText);
    
    if (aiAnalysis && aiAnalysis.type === 'INFO' && aiAnalysis.reply) {
        logAction('INFO', `(IA) Pregunta técnica detectada. Usando respuesta generada.`);
        return aiAnalysis.reply;
    }
    
    if (aiAnalysis && aiAnalysis.type === 'UNKNOWN') {
        logAction('WARN', `(IA) Pregunta ambigua o sin datos técnicos. NO responder automáticamente.`);
        return null;
    }

    // 2. Si es STOCK o por defecto, usar lógica de inventario estándar
    const availability = calculateAvailability(product.Stock_Actual, product.Lote_Inicial);
    return `Hola! Gracias por tu interés. ${availability}. El precio es $${product.Precio}. Esperamos tu compra!`;
}

async function processQuestion(page, questionElement, inventory, answerBtnHandle) {
    try {
        // Intentar extraer texto y título usando selectores más robustos
        // Mercado Libre usa estructuras como .questions__item--question, .questions__content, etc.
        const questionText = await questionElement.evaluate(el => {
            // Intentar encontrar el texto de la pregunta
            const p = el.querySelector('.questions__content p') || 
                      el.querySelector('p') || 
                      el.querySelector('[class*="text"]');
            return p ? p.innerText : null;
        });

        const productTitle = await questionElement.evaluate(el => {
             // Intentar encontrar el título del producto asociado
             // A veces está en un enlace o encabezado cercano
            const a = el.querySelector('a.questions__item--link') || 
                      el.querySelector('a') || 
                      el.querySelector('[class*="item"]');
            return a ? a.innerText : null;
        });

        if (!questionText) {
            logAction('WARN', 'No se pudo leer el texto de la pregunta. Saltando...');
            return;
        }

        const finalProductTitle = productTitle || "Producto Desconocido";

        logAction('INFO', `Procesando pregunta: "${questionText}" sobre "${finalProductTitle}"`);
        
        // ENVIAR AL BACKEND (Dashboard) - SIEMPRE
        try {
            sendToWebhook(questionText, finalProductTitle);
        } catch (e) {
            logAction('ERROR', `Error webhook: ${e.message}`);
        }

        // Simular lectura humana (espera breve)
        await delay(2000); 

        const product = findProduct(inventory, finalProductTitle);
        
        // AHORA pasamos también el texto de la pregunta
        const responseText = await generateResponse(product, questionText);

        if (!responseText) {
            logAction('WARN', `Producto no encontrado o Pregunta sin respuesta automática ("${finalProductTitle}"). NO se responderá.`);
            return;
        }

        // Hacer clic en "Responder" para abrir el campo de texto
        let textarea = await questionElement.$('textarea');
        
        if (!textarea) {
             await answerBtnHandle.click();
             await delay(1000); // Esperar animación
             textarea = await questionElement.$('textarea');
        }
        
        if (!textarea) {
            logAction('ERROR', 'No se encontró el campo de texto después de hacer clic en Responder.');
            return;
        }

        await humanType(page, textarea, responseText);
        
        // Buscar botón de enviar (generalmente "Responder" azul)
        const submitBtn = await questionElement.$('button[type="submit"]') || 
                          await questionElement.$('button[class*="primary"]') ||
                          await questionElement.$('button.questions__answer-submit');
        
        if (submitBtn) {
            // ACTIVAR RESPUESTA REAL
            await submitBtn.click();
            logAction('SUCCESS', `(ENVIADO) Se respondió: "${responseText}"`);
        } else {
            logAction('ERROR', 'No se encontró el botón de enviar respuesta.');
        }

    } catch (error) {
        logAction('ERROR', `Error al procesar pregunta: ${error.message}`);
    }
}

async function processPendingReplies(page, pendingReplies) {
    if (!pendingReplies || pendingReplies.length === 0) return;
    
    logAction('INFO', `Procesando ${pendingReplies.length} respuestas pendientes del Dashboard...`);

    // Escanear todas las preguntas en la página actual
    // Necesitamos encontrar los botones "Responder" y calcular el hash de su texto para ver si coincide
    
    // NOTA: page.$x() deprecado. Usamos xpath/
    const answerButtons = await page.$$("xpath///button[contains(., 'Responder')] | //span[contains(., 'Responder')]");
    
    for (const reply of pendingReplies) {
        const targetId = reply.lead.remote_id;
        const content = reply.content;
        let matched = false;

        for (const btn of answerButtons) {
            try {
                // Obtener contenedor
                const questionContainer = await btn.evaluateHandle(el => {
                    return el.closest('div[class*="question"]') || el.parentElement.parentElement.parentElement;
                });

                // Obtener texto para calcular hash
                const questionText = await questionContainer.evaluate(el => {
                    const p = el.querySelector('p') || el.querySelector('[class*="text"]');
                    return p ? p.innerText : null;
                });

                if (questionText) {
                    const currentId = calculateRemoteId(questionText);
                    if (currentId === targetId) {
                        logAction('INFO', `Encontrada pregunta para responder: ${targetId}`);
                        
                        // Hacer clic en Responder
                        await btn.click();
                        await delay(1000); // Esperar UI

                        const textarea = await questionContainer.$('textarea');
                        if (textarea) {
                            await humanType(page, textarea, content);
                            
                            const submitBtn = await questionContainer.$('button[type="submit"]') || await questionContainer.$('button[class*="primary"]');
                            if (submitBtn) {
                                // await submitBtn.click();
                                logAction('SUCCESS', `(PENDIENTE ENVIADO) Respuesta enviada: "${content}"`);
                                matched = true;
                            }
                        }
                        break; // Pasamos a la siguiente reply
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }
        
        if (!matched) {
            logAction('WARN', `No se encontró la pregunta ${targetId} en la página actual para responder.`);
        }
    }
}

// Función Principal del Bot
async function runBot() {
    logAction('SYSTEM', 'Iniciando bot de Mercado Libre...');

    const browser = await puppeteer.launch({
        headless: false, // Visible para depuración y login manual inicial
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
    
    // Navegar a Mercado Libre Venezuela (Vista inicial)
    // NOTA: El usuario debe realizar el login manual la primera vez
    await page.goto('https://www.mercadolibre.com.ve/preguntas/vendedor', { waitUntil: 'networkidle2' });
    
    logAction('INFO', 'Por favor, asegúrate de haber iniciado sesión manualmente. El bot guardará la sesión.');
    logAction('INFO', 'El bot comenzará el ciclo de monitoreo...');

    let nextScanTime = Date.now() + 10000; // Primer escaneo rápido en 10s

    // Bucle infinito de monitoreo inteligente
    while (true) {
        try {
            // 1. Verificar respuestas pendientes (Frecuente - cada 15s)
            // Se realiza al final del bucle en el delay
            
            // 2. Escaneo automático
            if (Date.now() >= nextScanTime) {
                // Verificar si estamos en la URL correcta, si no, navegar
                if (!page.url().includes('preguntas/vendedor')) {
                     logAction('NAV', 'Navegando a la sección de preguntas...');
                     await page.goto('https://www.mercadolibre.com.ve/preguntas/vendedor', { waitUntil: 'networkidle2' });
                } else {
                     // Recargar para ver nuevas preguntas
                     logAction('NAV', 'Recargando página de preguntas...');
                     await page.reload({ waitUntil: 'networkidle2' });
                }

                // Procesar preguntas nuevas
                logAction('INFO', 'Escaneando preguntas nuevas (Auto-Reply)...');
                
                // Usar selectores más robustos y múltiples
                // Mercado Libre a veces cambia las clases, buscamos botones que contengan "Responder"
                // NOTA: page.$x() fue deprecado en versiones nuevas de Puppeteer. Usamos xpath/
                const answerButtons = await page.$$("xpath///button[contains(., 'Responder')] | //span[contains(., 'Responder')] | //div[contains(@class, 'questions__item')]//button | //div[contains(@class, 'ui-pdp-questions__questions-list__item')]//button");
                
                if (answerButtons.length > 0) {
                     logAction('INFO', `Encontrados ${answerButtons.length} posibles botones de respuesta.`);
                     
                     // Iterar y procesar
                     // Nota: Al responder una, la página puede cambiar, así que es mejor procesar una por ciclo o manejarlo con cuidado
                     // Por simplicidad, intentamos procesar todas las visibles
                     
                     for (const btn of answerButtons) {
                         try {
                            // Verificar si es visible
                            const isVisible = await btn.evaluate(el => {
                                const style = window.getComputedStyle(el);
                                return style && style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
                            });
                            
                            if (!isVisible) continue;

                            const questionContainer = await btn.evaluateHandle(el => {
                                return el.closest('div[class*="question"]') || 
                                       el.closest('div[class*="item"]') || 
                                       el.closest('.ui-pdp-questions__questions-list__item') ||
                                       el.parentElement.parentElement;
                            });
                            
                            await processQuestion(page, questionContainer, loadInventory(), btn);
                         } catch (err) {
                             // logAction('ERROR', `Error al procesar una pregunta (puede que ya no exista): ${err.message}`);
                         }
                     }
                } else {
                    logAction('INFO', 'No se detectaron preguntas pendientes de respuesta. Verificando estado de página...');
                    
                    // DIAGNÓSTICO PROFUNDO:
                    // 1. Verificar si hay preguntas pero el bot no ve el botón
                    const pageText = await page.evaluate(() => document.body.innerText);
                    if (pageText.includes("Preguntas") && !pageText.includes("No tienes preguntas")) {
                        logAction('WARN', 'La página parece tener preguntas, pero no encontré botones "Responder".');
                        logAction('DEBUG', 'Guardando snapshot HTML para diagnóstico...');
                        const htmlContent = await page.content();
                        fs.writeFileSync('debug_ml_page.html', htmlContent);
                        logAction('DEBUG', 'Snapshot guardado en "debug_ml_page.html".');
                    } else {
                        logAction('INFO', 'La página indica que no hay preguntas nuevas.');
                    }
                }
                
                // Programar próximo escaneo
                const waitTime = randomDelay(CHECK_INTERVAL_MIN, CHECK_INTERVAL_MAX);
                nextScanTime = Date.now() + waitTime;
                const waitMinutes = (waitTime / 60000).toFixed(1);
                logAction('WAIT', `Próximo escaneo automático en ${waitMinutes} minutos...`);
            }

            // 3. Verificar respuestas pendientes del Dashboard
            const pendingReplies = await pollPendingReplies();
            if (pendingReplies && pendingReplies.length > 0) {
                await processPendingReplies(page, pendingReplies);
            }

        } catch (error) {
            logAction('ERROR', `Ocurrió un error en el ciclo principal: ${error.message}`);
            await delay(5000); // Espera de seguridad ante errores
        }

        // Breve pausa para no saturar CPU
        await delay(15000); // Revisar cada 15s
    }
}

runBot();
