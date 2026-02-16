import fetch from "node-fetch"

export async function sendAdminNotification({ name, email, phone, service, datetime, appointmentId }) {
  const token = process.env.TELEGRAM_BOT_TOKEN || ""
  const chatId = process.env.TELEGRAM_CHAT_ID || ""
  if (!token || !chatId) return
  const dateStr = new Date(datetime).toLocaleString("es-ES")
  const text = [
    "Nueva solicitud:",
    `Cliente: ${name}`,
    `Email: ${email}`,
    `Teléfono: ${phone}`,
    `Servicio: ${service}`,
    `Fecha/Hora: ${dateStr}`,
    `ID cita: ${appointmentId}`,
    "Acciones: /aceptar ID o /rechazar ID"
  ].join("\n")
  await sendText(chatId, text)
}

export async function sendText(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || ""
  if (!token || !chatId) return
  const url = `https://api.telegram.org/bot${token}/sendMessage`
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  })
}

export function parseCommand(text) {
  const t = String(text || "").trim()
  let m = t.match(/^\/aceptar\s+(\d+)/i)
  if (m) return { action: "accept", id: Number(m[1]) }
  m = t.match(/^\/rechazar\s+(\d+)/i)
  if (m) return { action: "reject", id: Number(m[1]) }
  return null
}
