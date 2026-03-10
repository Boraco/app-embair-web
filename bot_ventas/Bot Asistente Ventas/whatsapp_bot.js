const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
require('dotenv').config(); // Cargar variables de entorno

// Configuración de API Backend
// Si estamos en VPS, usar 'localhost' si el bot corre ahí, o la IP/Dominio si corre fuera
const API_HOST = process.env.API_HOST || 'localhost'; 
const API_PORT = process.env.API_PORT || 3002;
const API_PROTOCOL = process.env.API_PROTOCOL || 'http'; // http o https
const requestModule = API_PROTOCOL === 'https' ? https : http;

// DETECCIÓN DE IP LOCAL O DOMINIO PÚBLICO PARA LINKS (Móvil)
// En VPS, esto debe ser tu dominio (ej: mitienda.com)
const PUBLIC_HOST = process.env.PUBLIC_HOST || 'localhost'; 
const PUBLIC_URL = process.env.PUBLIC_URL || `${API_PROTOCOL}://${PUBLIC_HOST}:${API_PORT}`;

// Función para llamar a la API del Bot (Centralizada)
function callBotApi(text, senderId) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ text, senderId });
        const options = {
            hostname: API_HOST,
            port: API_PROTOCOL === 'https' ? 443 : API_PORT, // Si es HTTPS, puerto 443 por defecto
            path: '/api/bot/chat',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        
        const req = requestModule.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve({ type: 'error', text: 'Error procesando respuesta del servidor' });
                    }
                } else {
                    resolve({ type: 'error', text: 'Error en el servidor central' });
                }
            });
        });

        req.on('error', (e) => {
            console.error("Error conectando con API Bot:", e);
            resolve({ type: 'error', text: 'Sin conexión con el sistema central' });
        });
        
        req.write(payload);
        req.end();
    });
}

// Función para enviar mensaje al webhook del backend
async function sendToWebhook(msg) {
    try {
        const chat = await msg.getChat();
        const contact = await msg.getContact();
        const remoteId = chat.isGroup ? chat.id.user : (msg.fromMe ? msg.to.split('@')[0] : msg.from.split('@')[0]);
        
        // Si es grupo, ignoramos por ahora (ya está filtrado en el evento, pero por seguridad)
        if (chat.isGroup) return;

        const data = JSON.stringify({
            platform: 'whatsapp',
            remote_id: remoteId,
            sender_name: msg.fromMe ? "Bot" : (contact.pushname || "Desconocido"),
            content: msg.body,
            timestamp: new Date().toISOString(),
            sender_type: msg.fromMe ? "agent" : "user"
        });

        const options = {
            hostname: API_HOST,
            port: API_PROTOCOL === 'https' ? 443 : API_PORT,
            path: '/api/chat/webhook',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = requestModule.request(options, res => {
            // console.log(`Webhook status: ${res.statusCode}`);
        });

        req.on('error', error => {
            console.error('Error enviando al webhook:', error);
        });

        req.write(data);
        req.end();
    } catch (error) {
        console.error("Error preparando webhook:", error);
    }
}

// Función para obtener y enviar respuestas pendientes
function pollPendingReplies() {
    const options = {
        hostname: API_HOST,
        port: API_PROTOCOL === 'https' ? 443 : API_PORT,
        path: '/api/chat/pending-replies/whatsapp',
        method: 'GET'
    };

    const req = requestModule.request(options, res => {
        let data = '';

        res.on('data', chunk => {
            data += chunk;
        });

        res.on('end', async () => {
            try {
                if (res.statusCode === 200) {
                    const messages = JSON.parse(data);
                    for (const msg of messages) {
                        try {
                            if (!msg.lead) {
                                console.error(`[ERROR] Mensaje pendiente ${msg.id} no tiene datos de Lead asociados.`);
                                continue;
                            }
                            const remoteId = msg.lead.remote_id;
                            // Enviar mensaje por WhatsApp
                            // El remote_id de WhatsApp suele necesitar @c.us al final si no lo tiene
                            // Pero contact.number suele ser el formato correcto para sendMessage (e.g. 54911...)
                            let chatId = remoteId;
                            if (!chatId.includes('@c.us')) {
                                chatId = `${chatId}@c.us`;
                            }

                            await client.sendMessage(chatId, msg.content);
                            console.log(`[Respuesta Enviada] A: ${remoteId} - Texto: "${msg.content}"`);

                            // Confirmar envío
                            confirmMessageSent(msg.id);
                        } catch (err) {
                            console.error(`Error enviando mensaje a ${msg.lead.remote_id}:`, err);
                        }
                    }
                }
            } catch (e) {
                console.error('Error procesando respuestas pendientes:', e);
            }
        });
    });

    req.on('error', error => {
        // Silenciar errores de conexión para no llenar la consola si el backend está apagado
        // console.error('Error polling pending replies:', error);
    });

    req.end();
}

function confirmMessageSent(messageId) {
    const options = {
        hostname: API_HOST,
        port: API_PROTOCOL === 'https' ? 443 : API_PORT,
        path: `/api/chat/messages/${messageId}/confirm`,
        method: 'POST'
    };

    const req = requestModule.request(options, res => {});
    req.on('error', e => console.error('Error confirmando mensaje:', e));
    req.end();
}


// Manejo de errores global
process.on('uncaughtException', (err) => {
    console.error('\n[ERROR CRÍTICO] Ocurrió un error inesperado:\n');
    console.error(err);
    console.error('\n--------------------------------------------------');
    console.error('POSIBLES SOLUCIONES:');
    console.error('1. Si el error menciona "EBUSY" o "locked", CIERRA el archivo Excel y vuelve a intentar.');
    console.error('2. Si falta algún módulo, ejecuta: npm install');
    console.error('3. Verifica que tengas internet para conectar con WhatsApp.');
    console.error('--------------------------------------------------\n');
});

// Configuración del archivo Excel
const EXCEL_FILE = 'inventario_ml.xlsx';
const LEADS_FILE = 'clientes_leads.xlsx';

// Función para guardar/actualizar Lead en Excel
function saveLead(contact, interest = '', status = 'Nuevo') {
    let workbook;
    let leads = [];

    // 1. Cargar o crear archivo de Leads
    if (fs.existsSync(LEADS_FILE)) {
        try {
            workbook = xlsx.readFile(LEADS_FILE);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            leads = xlsx.utils.sheet_to_json(worksheet);
        } catch (e) {
            console.error("Error leyendo archivo de leads, creando uno nuevo.", e);
            workbook = xlsx.utils.book_new();
            leads = [];
        }
    } else {
        workbook = xlsx.utils.book_new();
        leads = [];
    }

    // 2. Preparar datos
    const now = new Date().toLocaleString();
    const phoneNumber = contact.number;
    const name = contact.pushname || "Desconocido";

    // 3. Buscar si ya existe el cliente
    let leadIndex = leads.findIndex(l => l.Telefono == phoneNumber);
    
    if (leadIndex >= 0) {
        // Actualizar cliente existente
        leads[leadIndex].Ultima_Interaccion = now;
        leads[leadIndex].Nombre = name; // Actualizar nombre si cambió
        if (interest) leads[leadIndex].Ultimo_Interes = interest;
        if (status !== 'Nuevo') leads[leadIndex].Estado = status; // Actualizar estado si es relevante
        leads[leadIndex].Mensajes_Totales = (leads[leadIndex].Mensajes_Totales || 0) + 1;
    } else {
        // Crear nuevo cliente
        leads.push({
            Fecha_Registro: now,
            Nombre: name,
            Telefono: phoneNumber,
            Ultimo_Interes: interest,
            Ultima_Interaccion: now,
            Estado: status,
            Mensajes_Totales: 1
        });
    }

    // 4. Guardar cambios
    try {
        const newSheet = xlsx.utils.json_to_sheet(leads);
        const newWorkbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(newWorkbook, newSheet, "Leads");
        xlsx.writeFile(newWorkbook, LEADS_FILE);
        console.log(`[LEAD] Datos guardados para: ${name} (${status})`);
    } catch (e) {
        console.error("Error guardando archivo de leads (puede estar abierto):", e);
    }
}

// Función para leer el inventario desde Excel
function getInventory() {
    if (!fs.existsSync(EXCEL_FILE)) {
        console.error(`[ERROR] No se encontró el archivo de inventario: ${EXCEL_FILE}`);
        return [];
    }

    try {
        const workbook = xlsx.readFile(EXCEL_FILE);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convertir a JSON
        const data = xlsx.utils.sheet_to_json(worksheet);
        
        // Procesar datos con "relleno" (fill down) de Categoría y Tipo
        const processedData = [];
        let lastCategory = "General";
        let lastType = "";

        data.forEach(row => {
            // Actualizar referencias si la fila tiene datos, si no, usar anterior
            if (row.Categoria) lastCategory = row.Categoria;
            if (row.Tipo) lastType = row.Tipo;

            // Si la fila no tiene producto, saltarla (puede ser fila vacía o solo encabezado de categoría)
            if (!row.Producto && !row.producto) return;

            processedData.push({
                producto: row.Producto || row.producto || "",
                stock: row.Stock_Actual || row.stock_actual || 0,
                precio: row.Precio || row.precio || 0,
                lote: row.Lote_Inicial || row.lote_inicial || 0,
                categoria: lastCategory,
                tipo: row.Tipo || lastType || "",
                medida: row.Medida || row.medida || "",
                datos_tecnicos: row.Datos_Tecnicos || row.datos_tecnicos || ""
            });
        });

        return processedData;
    } catch (error) {
        console.error("[ERROR] Error leyendo el archivo Excel:", error);
        return [];
    }
}

async function getAIResponse(product, question) {
    if (!product) return null;

    try {
        const payload = {
            platform: "whatsapp",
            product_name: product.producto,
            question: question,
            product_info: product.datos_tecnicos || "", // Usar columna del Excel
            price: product.precio,
            stock: product.stock
        };

        const options = {
            hostname: API_HOST,
            port: API_PROTOCOL === 'https' ? 443 : API_PORT,
            path: '/api/ai/analyze',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(JSON.stringify(payload))
            }
        };

        return new Promise((resolve) => {
            const req = requestModule.request(options, (res) => {
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

// Función para buscar producto (búsqueda parcial/fuzzy simple)
function findProduct(query, inventory) {
    if (!query || query.length < 3) return null; // Ignorar búsquedas muy cortas
    
    const queryLower = query.toLowerCase();
    
    // Buscar coincidencia exacta o parcial
    const match = inventory.find(item => 
        item.producto.toLowerCase().includes(queryLower)
    );
    
    return match;
}

// Función para calcular disponibilidad (texto)
function getAvailabilityText(stock) {
    if (stock > 5) return "✅ Disponible";
    if (stock > 0) return "⚠️ Pocas unidades disponibles";
    return "❌ Agotado";
}

// Inicializar cliente de WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({ clientId: "meli-bot" }),
    puppeteer: {
        headless: true, // Cambiar a false si quieres ver el navegador abriéndose
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas'
        ]
    }
});

// Evento: Generación de código QR
client.on('qr', (qr) => {
    console.log('\n===================================================');
    console.log('ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP (Dispositivos vinculados)');
    console.log('===================================================\n');
    qrcode.generate(qr, { small: true });
});

// Evento: Cliente listo
client.on('ready', () => {
    console.log('\n===================================================');
    console.log('✅ BOT DE WHATSAPP LISTO Y CONECTADO');
    console.log('   - Leyendo inventario de: ' + EXCEL_FILE);
    console.log('   - Esperando mensajes...');
    console.log('===================================================\n');
});

// Estado de usuarios en memoria (simple)
const userState = {};
const sessionMemory = {};

// Estado de chats PAUSADOS (cuando solicitan asesor)
const pausedChats = new Set();

// Función para normalizar texto (quitar tildes, minúsculas)
function normalize(text) {
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Evento: Mensaje creado (enviado o recibido) - Para sincronizar TODO con el Dashboard
client.on('message_create', async msg => {
    // Ignorar actualizaciones de estado
    if (msg.from === 'status@broadcast' || msg.isStatus) return;
    
    // Si el mensaje es enviado por el AGENTE (desde Dashboard o Web),
    // debemos asegurarnos de DESPAUSAR el chat para que el bot pueda volver a interactuar si se desea,
    // O mantenerlo pausado si el agente sigue hablando.
    // Generalmente, si el agente responde, el bot debe seguir callado hasta que se reactive explícitamente,
    // pero por simplicidad, si el agente escribe, asumimos que está atendiendo.
    // Podríamos agregar un comando "!resume" para reactivar el bot.
    
    // Sincronizar con el backend
    await sendToWebhook(msg);
});

// Evento: Mensaje recibido (solo entrantes) - Para lógica del Bot
client.on('message', async msg => {
    // Logging exhaustivo para debug
    console.log('---------------------------------------------------');
    console.log(`[DEBUG] Mensaje recibido de: ${msg.from}`);
    console.log(`[DEBUG] Tipo de chat: ${msg.from.includes('@g.us') ? 'Grupo' : 'Individual'}`);
    console.log(`[DEBUG] Contenido: ${msg.body.substring(0, 50)}...`);

    // Ignorar Estados (Stories)
    if (msg.from === 'status@broadcast' || msg.isStatus) {
        console.log('[DEBUG] Ignorando mensaje de estado (Story).');
        return;
    }

    // Ignorar grupos
    if (msg.from.includes('@g.us')) {
        console.log('[DEBUG] Ignorando mensaje de grupo.');
        return;
    }

    const contact = await msg.getContact();
    const chat = await msg.getChat();
    
    // Normalizar ID para la base de datos (solo números)
    let remoteId = contact.number; 
    if (!remoteId) {
        // Fallback si contact.number es undefined, intentar extraer del ID
        remoteId = msg.from.replace('@c.us', '');
    }
    const userId = remoteId; // Mantener compatibilidad con variable userId
    
    console.log(`[DEBUG] Remote ID procesado: ${remoteId}`);

    const text = msg.body.toLowerCase().trim();
    const messageBody = msg.body; // Texto original preservado

    // ENVIAR AL WEBHOOK (Dashboard)
    // Usamos una versión modificada de sendToWebhook para asegurar que llegue
    try {
        const payload = JSON.stringify({
            platform: 'whatsapp',
            remote_id: remoteId,
            sender_name: contact.pushname || contact.name || "Desconocido",
            content: messageBody,
            timestamp: new Date().toISOString(),
            sender_type: "user"
        });
        
        const options = {
            hostname: API_HOST,
            port: API_PROTOCOL === 'https' ? 443 : API_PORT,
            path: '/api/chat/webhook',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        
        const req = requestModule.request(options, (res) => {
             console.log(`[Webhook] Enviado al dashboard. Status: ${res.statusCode}`);
        });
        req.on('error', (e) => console.error(`[Webhook] Error: ${e.message}`));
        req.write(payload);
        req.end();

    } catch (e) {
        console.error("[Webhook] Error crítico enviando:", e);
    }

    // Verificar si el bot está pausado para este chat
    if (pausedChats.has(remoteId)) {
        // Permitir reactivación
        if (text === '!bot' || text === 'menu') {
            pausedChats.delete(remoteId);
            await msg.reply("🤖 Bot reactivado. ¿En qué puedo ayudarte?");
            return;
        }
        console.log(`[BOT] Pausado para ${remoteId}. No se responde automáticamente.`);
        return;
    }

    // Comandos de Admin / Reset / Asesor
    if (text.includes('asesor') || text.includes('humano')) {
         pausedChats.add(remoteId);
         await msg.reply("👨‍💻 *Entendido. Te pondré en contacto con un asesor humano.*\n\nEl bot se ha pausado.");
         return;
    }

    // ---------------------------------------------------------
    // INTEGRACIÓN CON API CENTRAL (APP ECOMERCE)
    // ---------------------------------------------------------
    
    // 0. Revisar estado local antes de llamar a la IA (Flujo Force Portal)
    if (sessionMemory[remoteId]) {
        // Etapa 1: Recibimos el NOMBRE -> Pedimos ZONA
        if (sessionMemory[remoteId].stage === 'waiting_name') {
            sessionMemory[remoteId].name = messageBody; // Guardar Nombre
            sessionMemory[remoteId].stage = 'waiting_zone';
            
            await msg.reply(`Gracias ${messageBody}. 🌎 ¿Desde qué ciudad o zona nos escribes?`);
            return;
        }
        
        // Etapa 2: Recibimos la ZONA -> Generamos LINK
        if (sessionMemory[remoteId].stage === 'waiting_zone') {
            const zona = messageBody;
            sessionMemory[remoteId].zona = zona; // Guardar zona en memoria
            const name = sessionMemory[remoteId].name;
            sessionMemory[remoteId].stage = 'ready'; // Fin del flujo
            
            // Generar Link al Portal con datos pre-cargados
            // Usamos PUBLIC_URL para que funcione en móviles
            const linkBase = `/landing.html?source=whatsapp`;
            const link = `${PUBLIC_URL}${linkBase}&name=${encodeURIComponent(name)}&phone=${encodeURIComponent(remoteId)}&zona=${encodeURIComponent(zona)}`;
            
            await msg.reply(`¡Perfecto! Hemos preparado tu acceso personalizado.\n\n👤 *Nombre:* ${name}\n📍 *Zona:* ${zona}\n\nIngresa aquí para ver el catálogo y precios:\n${link}`);
            return;
        }
    }

    // 1. Consultar IA Central
    const response = await callBotApi(text, remoteId);
    const { type, text: replyText, linkBase, product } = response;

    // 2. Procesar Respuesta
    if (type === 'faq') {
        await msg.reply(replyText);
    } 
    else if (type === 'portal_redirect') {
        // Inicializar memoria si no existe
        if (!sessionMemory[remoteId]) sessionMemory[remoteId] = {};

        // 1. Falta Nombre
        if (!sessionMemory[remoteId].name) {
            sessionMemory[remoteId].stage = 'waiting_name';
            await msg.reply(replyText || "Hola, para atenderte mejor, indícame tu Nombre y Apellido.");
        } 
        // 2. Falta Zona (Nuevo paso)
        else if (!sessionMemory[remoteId].zona) {
            sessionMemory[remoteId].stage = 'waiting_zone';
            await msg.reply(`Hola ${sessionMemory[remoteId].name}. 🌎 ¿Desde qué ciudad o zona nos escribes?`);
        }
        // 3. Todo listo -> Reenviar Link
        else {
            const name = sessionMemory[remoteId].name;
            const zona = sessionMemory[remoteId].zona;
            // Usamos IP real para que el link funcione en el celular
            const linkBase = `/landing.html?source=whatsapp`;
            const link = `${PUBLIC_URL}${linkBase}&name=${encodeURIComponent(name)}&phone=${encodeURIComponent(remoteId)}&zona=${encodeURIComponent(zona)}`;
            await msg.reply(`Hola de nuevo ${name}. Aquí tienes tu acceso para completar tu pedido:\n${link}`);
        }
    }
    else if (type === 'product' && product) {
        // Formatear respuesta de producto
        await msg.reply(replyText);
    }
    else {
        // Fallback / Unknown
        await msg.reply(replyText || "Disculpa, no entendí. ¿Podrías repetir?");
    }
});

// =========================================================
// INICIALIZACIÓN Y POLLING
// =========================================================

console.log('Iniciando sistema de WhatsApp...');
client.initialize();

// Polling de mensajes pendientes
setInterval(() => {
    pollPendingReplies();
}, 5000);
