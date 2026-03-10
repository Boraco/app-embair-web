/**
 * EJEMPLO AVANZADO DE INTEGRACIÓN PARA BOT DE VENTAS (WhatsApp / MercadoLibre)
 * 
 * Este código permite conectar tu bot externo con el módulo "Bot de Ventas" de la App Ecommerce.
 * Soporta:
 * 1. Consultas de Stock y Precios (si no está activo el modo "Solo Portal").
 * 2. Redirección inteligente al Portal de Ventas (si está activo "Fuerza Portal").
 * 3. Respuestas automáticas de FAQs configuradas en el admin.
 * 
 * Uso: Integra estas funciones en tu bot (Node.js, Python, etc).
 */

const axios = require('axios'); // npm install axios

// Configuración
const API_URL = 'http://localhost:3002/api/bot/chat'; 
const API_CONFIG_URL = 'http://localhost:3002/api/bot/config';

// Simulación de memoria de sesión (en producción usar base de datos)
const sessionMemory = {}; 

/**
 * Función principal para procesar mensajes del cliente
 * @param {string} userId - ID único del usuario (ej: número de teléfono)
 * @param {string} userMessage - Mensaje recibido
 */
async function processMessage(userId, userMessage) {
  try {
    console.log(`[Bot] Usuario ${userId} dice: "${userMessage}"`);

    // 0. Revisar estado local antes de llamar a la IA
    // Si ya le pedimos el nombre, lo guardamos y generamos el link sin consultar a la API
    if (sessionMemory[userId] && sessionMemory[userId].stage === 'waiting_name') {
      sessionMemory[userId].name = userMessage;
      sessionMemory[userId].stage = 'ready';
      const link = `http://localhost:3002/landing.html?source=bot&name=${encodeURIComponent(userMessage)}&phone=${encodeURIComponent(userId)}`;
      return `Gracias ${userMessage}. Ingresa aquí para ver nuestro catálogo personalizado:\n${link}`;
    }

    // 1. Consultar IA Central
    const response = await axios.post(API_URL, {
      text: userMessage,
      senderId: userId
    });

    const { type, text, linkBase, product } = response.data;

    // CASO 1: FAQ (Pregunta Frecuente)
    // La IA respondió una duda general (horario, ubicación, etc)
    if (type === 'faq') {
      return text;
    }

    // CASO 2: REDIRECCIÓN AL PORTAL (Modo Ventas)
    // El admin configuró que el bot derive al portal para cerrar ventas
    if (type === 'portal_redirect') {
      
      // Verificar si ya tenemos el nombre del usuario en sesión
      if (!sessionMemory[userId] || !sessionMemory[userId].name) {
        // Si es la primera vez que nos escribe o no sabemos su nombre
        // Guardamos el estado para esperar el nombre en el siguiente mensaje
        sessionMemory[userId] = { stage: 'waiting_name' };
        
        // Devolvemos el texto de entrenamiento (ej: "Hola, indícame tu nombre...")
        return text; 
      }
      
      // Si ya sabemos el nombre, generamos el link personalizado
      const name = sessionMemory[userId].name;
      const link = `http://localhost:3002${linkBase}&name=${encodeURIComponent(name)}&phone=${encodeURIComponent(userId)}`;
      
      return `Gracias ${name}. Para completar tu solicitud y ver precios/stock según tu perfil, ingresa aquí:\n${link}`;
    }

    // CASO 3: RESPUESTA DE PRODUCTO (Si Modo Ventas está desactivado)
    if (type === 'product' && product) {
      return text; // Ej: "Encontré Cable #12 a $50..."
    }

    // CASO 4: NO ENTENDIÓ / FALLBACK
    return text || "Disculpa, no entendí. ¿Podrías repetir?";

  } catch (error) {
    console.error("Error conectando con App Ecommerce:", error.message);
    return "En este momento no puedo conectarme. Intenta más tarde.";
  }
}

// --- SIMULACIÓN DE CHAT ---
(async () => {
  console.log("--- INICIANDO SIMULACIÓN ---");

  // Escenario 1: Usuario pregunta horario (FAQ)
  console.log("Bot:", await processMessage("584121234567", "cual es el horario?"));

  // Escenario 2: Usuario saluda (Activa flujo Portal)
  console.log("Bot:", await processMessage("584121234567", "hola buenas"));
  
  // Escenario 3: Usuario responde con su nombre
  console.log("Bot:", await processMessage("584121234567", "Juan Perez"));

})();
