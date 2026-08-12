import express from "express"
import dotenv from "dotenv"
import rateLimit from "express-rate-limit"
import path from "path"
import { fileURLToPath } from "url"
import fs from "fs"
import multer from "multer"
import nodemailer from "nodemailer"
import crypto from "crypto"
import os from "os"
import { spawn } from "child_process"

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.set('trust proxy', 1) // Confía en el primer proxy (Nginx)
app.use(express.json({ limit: "10mb" }))

app.use((err, req, res, next) => {
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    return res.status(413).json({ error: "payload_too_large" })
  }
  return next(err)
})

function requireAdmin(req, res, next) {
  const user = process.env.ADMIN_USER || "admin"
  const pass = process.env.ADMIN_PASS || "admin"
  const passHash = process.env.ADMIN_PASS_HASH || ""
  const header = req.headers.authorization || ""
  const token = header.split(" ")[1] || ""
  const decoded = Buffer.from(token || "", "base64").toString()
  const [u, p] = decoded.split(":")
  const ok =
    u === user &&
    (passHash ? hashPassword(p) === passHash : p === pass)
  if (ok) return next()
  const isApi = req.path && req.path.startsWith("/api/")
  if (isApi) {
    return res.status(401).json({ error: "unauthorized" })
  }
  res.setHeader("WWW-Authenticate", 'Basic realm="Admin"')
  return res.status(401).send("Unauthorized")
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "landing.html"))
})

const protectedAdminPages = new Set([
  "/admin.html",
  "/productos.html",
  "/clientes.html",
  "/analytics.html",
  "/admin-bot.html",
  "/admin-ia.html",
  "/leads.html",
  "/crm.html",
  "/seo.html",
  "/editor.html",
  "/reportes.html",
  "/campaigns.html"
])

app.use((req, res, next) => {
  if (protectedAdminPages.has(req.path)) return requireAdmin(req, res, next)
  return next()
})

app.use((req, res, next) => {
  if (req.path && req.path.endsWith(".html")) {
    res.setHeader("Cache-Control", "no-store")
  }
  return next()
})

app.use(express.static(path.join(__dirname, "..", "public")))

function shouldRequireAdminView(req) {
  return String(req.query && req.query.admin_view ? req.query.admin_view : "") === "true"
}

app.get("/producto/:slug", (req, res) => {
  if (shouldRequireAdminView(req)) {
    return requireAdmin(req, res, () => {
      res.sendFile(path.join(__dirname, "..", "public", "index.html"))
    })
  }
  res.sendFile(path.join(__dirname, "..", "public", "index.html"))
})

app.get("/app", (req, res) => {
  if (shouldRequireAdminView(req)) {
    return requireAdmin(req, res, () => {
      res.sendFile(path.join(__dirname, "..", "public", "index.html"))
    })
  }
  res.sendFile(path.join(__dirname, "..", "public", "index.html"))
})

app.get("/api/admin/ping", requireAdmin, (req, res) => {
  res.json({ ok: true })
})

app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"))
})

const uploadDir = path.join(__dirname, "..", "public", "uploads")
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

const dataDir = path.join(__dirname, "..", "data")
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

const productsFile = path.join(dataDir, "products.json")
const clientsFile = path.join(dataDir, "clients.json")
const catalogsFile = path.join(dataDir, "catalogs.json")
const eventsFile = path.join(dataDir, "events.json")
const leadsFile = path.join(dataDir, "leads.json")
const ordersFile = path.join(dataDir, "orders.json")
const cartsFile = path.join(dataDir, "carts.json")
const tasksFile = path.join(dataDir, "tasks.json")

// Analytics & Events
app.get("/api/events", requireAdmin, (req, res) => {
  const data = readData(eventsFile)
  data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  res.json(data)
})

app.post("/api/events", (req, res) => {
  const event = {
    id: Date.now().toString(),
    createdAt: new Date().toISOString(),
    type: req.body.type || "unknown",
    sessionId: req.body.sessionId || "",
    email: req.body.email || "",
    deviceId: req.body.deviceId || "",
    meta: req.body.meta || {},
    ip: req.ip,
    userAgent: req.headers["user-agent"] || ""
  }
  const events = readData(eventsFile)
  events.unshift(event)
  if (events.length > 1000) events.length = 1000
  writeData(eventsFile, events)
  res.json({ ok: true })
})

app.get("/api/clients", requireAdmin, (req, res) => {
    const data = readData(clientsFile)
    res.json(data)
})

function normalizeEmail(v) {
  const email = String(v || "").trim().toLowerCase()
  return email && email.includes("@") ? email : ""
}

function normalizePhone(v) {
  const digits = String(v || "").replace(/\D+/g, "")
  return digits.length >= 8 ? digits : ""
}

function matchByEmailOrPhone(item, email, phone) {
  const itemEmail = normalizeEmail(item && item.email)
  const itemPhone = normalizePhone(item && item.celular)
  if (email && itemEmail && email === itemEmail) return true
  if (phone && itemPhone) {
    if (phone === itemPhone) return true
    const a = phone.length > 8 ? phone.slice(-8) : phone
    const b = itemPhone.length > 8 ? itemPhone.slice(-8) : itemPhone
    if (a && b && a === b) return true
  }
  return false
}

function upsertClientFromLead(lead) {
  const now = new Date().toISOString()
  const list = readData(clientsFile)
  const ced = String(lead && lead.cedula ? lead.cedula : "").trim()
  const cel = String(lead && lead.celular ? lead.celular : "").trim()
  const celKey = normalizePhone(cel)
  const emailKey = normalizeEmail(lead && lead.email ? lead.email : "")
  let found = null
  for (const c of list) {
    if (ced && String(c.cedula || "").trim() === ced) { found = c; break }
    if (!found && emailKey && normalizeEmail(c.email) === emailKey) found = c
    if (!found && celKey && normalizePhone(c.celular) === celKey) found = c
  }
  if (!found) {
    const newId = list.length ? Math.max(...list.map(x => Number(x.id) || 0)) + 1 : 1
    found = { id: newId, created_at: now }
    list.push(found)
  }
  if (lead && lead.nombre) found.nombre = String(lead.nombre || "").trim() || found.nombre
  if (lead && lead.apellido) found.apellido = String(lead.apellido || "").trim() || found.apellido
  if (ced) found.cedula = ced
  if (emailKey) found.email = emailKey
  if (cel) found.celular = cel
  if (lead && lead.direccion) found.direccion = String(lead.direccion || "").trim() || found.direccion
  if (lead && lead.entrega) found.entrega = String(lead.entrega || "").trim() || found.entrega
  if (lead && lead.zona) found.zona = String(lead.zona || "").trim() || found.zona
  if (lead && lead.tipo) found.tipo = String(lead.tipo || "").trim() || found.tipo
  found.interesado = true
  found.updated_at = now
  if (typeof found.pedidos !== "number") found.pedidos = 0
  writeData(clientsFile, list)
  return found
}

function readData(file) {
  try {
    if (!fs.existsSync(file)) return []
    const raw = fs.readFileSync(file, "utf-8")
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function writeData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

function hashPassword(pwd) {
  return crypto.createHash("sha256").update(String(pwd || "")).digest("hex")
}

function ensurePortalTestClient() {
  const email = process.env.PORTAL_TEST_EMAIL
  const password = process.env.PORTAL_TEST_PASSWORD
  if (!email || !password) return
  const list = readData(clientsFile)
  const now = new Date().toISOString()
  const emailLower = String(email).toLowerCase()
  let client = list.find(c => c.email && c.email.toLowerCase() === emailLower)
  if (!client) {
    client = {
      id: Date.now(),
      email,
      nombre: "Portal EMBAIR",
      apellido: "",
      celular: "",
      zona: "",
      tipo: "Empresa",
      created_at: now
    }
    list.push(client)
  }
  client.portalPasswordHash = hashPassword(password)
  client.updated_at = now
  writeData(clientsFile, list)
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir)
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || "")
    const name = path.basename(file.originalname || "file", ext).replace(/\W+/g, "_")
    const ts = Date.now()
    cb(null, `${name}_${ts}${ext}`)
  }
})
const upload = multer({ storage })

app.post("/api/upload", requireAdmin, upload.single("file"), (req, res) => {
  const f = req.file
  if (!f) return res.status(400).json({ error: "file_required" })
  const url = `/uploads/${f.filename}`
  return res.json({ ok: true, url })
})

app.get("/api/products", (req, res) => {
  const data = readData(productsFile)
  res.json(data)
})

app.post("/api/products", requireAdmin, (req, res) => {
  const data = req.body
  if (!Array.isArray(data)) return res.status(400).json({ error: "array_required" })
  writeData(productsFile, data)
  res.json({ ok: true })
})

const configFile = path.join(dataDir, "config.json")
const iaConfigFile = path.join(dataDir, "ia-config.json")
const botConfigFile = path.join(dataDir, "bot-config.json")

app.get("/api/config", (req, res) => {
  let data = readData(configFile)
  if (Array.isArray(data)) data = {}
  if (!data.logoUrl) data.logoUrl = ""
  res.json(data)
})

app.post("/api/config", requireAdmin, (req, res) => {
  const newConfig = req.body
  const current = readData(configFile)
  const updated = { ...current, ...newConfig }
  writeData(configFile, updated)
  res.json({ ok: true })
})

app.get("/api/ia/config", requireAdmin, (req, res) => {
  let data = readData(iaConfigFile)
  if (Array.isArray(data)) data = {}
  if (!data.keywords) data.keywords = []
  if (!data.prompts) data.prompts = []
  if (!data.faqs) data.faqs = []
  res.json(data)
})

app.post("/api/ia/config", requireAdmin, (req, res) => {
  writeData(iaConfigFile, req.body)
  res.json({ ok: true })
})

// --- SERVER-SIDE AI LOGIC ---
function findMatches(text, products, limit = 5) {
  const q = String(text || "").toLowerCase()
  const list = Array.isArray(products) ? products : []
  const matches = []
  
  const words = q.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  for (const p of list) {
    const name = String(p.name || "").toLowerCase()
    const cat = String(p.category || "").toLowerCase()
    const sub = String(p.subcategory || "").toLowerCase()
    const mat = String(p.material || "").toLowerCase()
    const brand = String(p.brand || "").toLowerCase()
    const desc = String(p.desc || "").toLowerCase()
    const tags = (Array.isArray(p.tags) ? p.tags.join(" ") : String(p.tags || "")).toLowerCase()
    
    if (p.code && String(p.code).toLowerCase() === q) {
      return [{ product: p, score: 100 }]
    }
    
    let score = 0
    let foundWords = 0
    
    for (const w of words) {
      let wordFound = false
      if (name.includes(w)) { score += 10; wordFound = true }
      else if (cat.includes(w)) { score += 5; wordFound = true }
      else if (sub.includes(w)) { score += 5; wordFound = true }
      else if (mat.includes(w)) { score += 5; wordFound = true }
      else if (brand.includes(w)) { score += 5; wordFound = true }
      else if (tags.includes(w)) { score += 3; wordFound = true }
      else if (desc.includes(w)) { score += 2; wordFound = true }
      
      if (wordFound) foundWords++
    }
    
    if (foundWords === words.length) score += 20
    
    if (score > 5) {
      matches.push({ product: p, score })
    }
  }
  
  matches.sort((a, b) => b.score - a.score)
  return matches.slice(0, limit)
}

// --- Bot Config Endpoints ---
let botProcessWA = null
let botProcessMP = null

app.get("/api/bot/status", requireAdmin, (req, res) => {
  res.json({
    wa: !!botProcessWA,
    meli: !!botProcessMP
  })
})

app.post("/api/bot/control", requireAdmin, (req, res) => {
  const { action, type } = req.body

  const botPath = path.join(__dirname, "..", "bot_ventas", "Bot Asistente Ventas")

  if (action === "start") {
    if (type === "wa") {
      if (botProcessWA) return res.json({ ok: true, message: "already_running" })
      
      console.log("Starting WA Bot at:", botPath)
      botProcessWA = spawn("node", ["whatsapp_bot.js"], { cwd: botPath, shell: true })
      
      botProcessWA.stdout.on("data", (data) => console.log(`[WA-BOT]: ${data}`))
      botProcessWA.stderr.on("data", (data) => console.error(`[WA-BOT-ERR]: ${data}`))
      
      botProcessWA.on("close", (code) => {
        console.log(`[WA-BOT] exited with code ${code}`)
        botProcessWA = null
      })
      return res.json({ ok: true })
    }
    
    if (type === "meli") {
       if (botProcessMP) return res.json({ ok: true, message: "already_running" })
       
       console.log("Starting Marketplace Bot at:", botPath)
       botProcessMP = spawn("node", ["marketplace_bot.js"], { cwd: botPath, shell: true })
       
       botProcessMP.stdout.on("data", (data) => console.log(`[MP-BOT]: ${data}`))
       botProcessMP.stderr.on("data", (data) => console.error(`[MP-BOT-ERR]: ${data}`))
       
       botProcessMP.on("close", (code) => {
         console.log(`[MP-BOT] exited with code ${code}`)
         botProcessMP = null
       })
       return res.json({ ok: true })
    }
  }
  
  if (action === "stop") {
    if (type === "wa" && botProcessWA) {
      spawn("taskkill", ["/pid", botProcessWA.pid, "/f", "/t"])
      botProcessWA = null
      return res.json({ ok: true })
    }
    if (type === "meli" && botProcessMP) {
      spawn("taskkill", ["/pid", botProcessMP.pid, "/f", "/t"])
      botProcessMP = null
      return res.json({ ok: true })
    }
  }
  
  res.json({ ok: false })
})

app.get("/api/bot/config", requireAdmin, (req, res) => {
  const data = readData(botConfigFile)
  const def = { 
    connections: { wa: false, meli: false }, 
    forcePortal: false, 
    training: "",
    showPrices: true
  }
  res.json({ ...def, ...data })
})

app.post("/api/bot/config", requireAdmin, (req, res) => {
  const newConfig = req.body
  writeData(botConfigFile, newConfig)
  res.json({ ok: true })
})

// --- ENDPOINT PRINCIPAL DE CHAT Y BOTS ---
app.post("/api/bot/chat", (req, res) => {
  const { text: message, sender, name } = req.body
  
  if (!message) return res.json({ type: "none", text: "" })
  
  const text = String(message).trim().toLowerCase()
  const config = readData(iaConfigFile)
  const botConfig = readData(botConfigFile)
  const products = readData(productsFile)
  
  let clientName = name || ""
  let clientType = ""
  let isClient = false
  let isLead = false
  
  if (sender) {
      const cleanSender = String(sender).replace(/\D/g, "")
      const clients = readData(clientsFile)
      const foundClient = clients.find(c => String(c.celular || "").replace(/\D/g, "").includes(cleanSender))
      if (foundClient) {
          clientName = foundClient.nombre || clientName
          clientType = foundClient.tipo || ""
          isClient = true
      } else {
          const leads = readData(leadsFile)
          const foundLead = leads.find(l => String(l.celular || "").replace(/\D/g, "").includes(cleanSender))
          if (foundLead) {
              clientName = foundLead.nombre || clientName
              clientType = foundLead.tipo || ""
              isLead = true
          }
      }
  }

  // 1. FAQs
  const faqs = Array.isArray(config.faqs) ? config.faqs : []
  const bestFaq = faqs.find(f => {
      const q = f.question.toLowerCase()
      const userTextIsKey = text.length > 3 && q.includes(text)
      return text.includes(q) || userTextIsKey
  })
  
  if (bestFaq) {
    let ans = bestFaq.answer
    if (clientName && (text.includes("hola") || text.includes("buenos"))) {
        ans = `Hola ${clientName}, ${ans}`
    }
    return res.json({ type: "faq", text: ans })
  }
  
  // 2. Modo Forzar Portal
  if (botConfig.forcePortal) {
    let msg = botConfig.training || "Hola, para brindarte la lista de precios y cotización personalizada, por favor ingresa al portal."
    let linkParams = "?source=bot"
    
    if (clientName) {
       linkParams += `&name=${encodeURIComponent(clientName)}&phone=${encodeURIComponent(sender || "")}`
       if (clientType) linkParams += `&type=${encodeURIComponent(clientType)}`
       msg = `Hola ${clientName}, puedes consultar el catálogo completo e inventario en tiempo real ingresando aquí:`
    }
    
    return res.json({
      type: "portal_redirect",
      text: msg,
      linkBase: "/landing.html" + linkParams
    })
  }

  // 3. Búsqueda de Productos con Stock y Precio
  const matches = findMatches(text, products)
  const showPrice = botConfig.showPrices !== false

  if (matches.length > 0) {
    if (matches.length === 1) {
        const p = matches[0].product
        const stockStatus = (p.available === "Disponible" || p.available === true) ? "Disponible en stock" : (p.available || "Consultar disponibilidad")
        const priceFormatted = Number(p.price || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const priceText = showPrice ? `\n• Precio: $${priceFormatted}` : ""
        
        let responseText = `*${p.name}*${priceText}\n• Stock: ${stockStatus}`
        
        if (clientName && (text.includes("hola") || text.includes("precio") || text.includes("cuanto") || text.includes("cuánto"))) {
             responseText = `Hola ${clientName}, aquí tienes la información:\n\n${responseText}`
        }
        
        return res.json({
            type: "product",
            text: responseText,
            product: {
                id: p.id,
                name: p.name,
                price: p.price,
                stock: stockStatus,
                link: `/producto/${p.id}`
            }
        })
    } else {
        let responseText = clientName ? `Hola ${clientName}, encontré estas opciones de materiales:\n\n` : "Encontré las siguientes opciones:\n\n"
        const items = []
        
        matches.forEach(m => {
            const p = m.product
            const stockStatus = (p.available === "Disponible" || p.available === true) ? "Stock" : "Agotado/Consultar"
            const priceFormatted = Number(p.price || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            const priceText = showPrice ? ` - *$${priceFormatted}*` : ""
            
            responseText += `• *${p.name}*${priceText} (${stockStatus})\n`
            items.push({
                id: p.id,
                name: p.name,
                price: p.price,
                stock: p.available,
                link: `/producto/${p.id}`
            })
        })
        
        responseText += "\n¿Deseas agregar alguno de estos a tu lista o ver más detalles?"
        
        return res.json({
            type: "multiple_products",
            text: responseText,
            products: items
        })
    }
  }

  // 4. Mensajes por defecto / Saludos
  let fallback = "Lo siento, no encontré ese material en el catálogo rápido. Indícame el código, medida o nombre exacto del producto (ej: Cable 12, Breaker 20A, Tubo PVC)."
  if (text === "hola" || text === "buenas" || text === "buenos dias" || text === "buenas noches" || text === "buenas tardes") {
      fallback = clientName ? `Hola ${clientName}, ¿qué materiales o insumos estás buscando hoy?` : "Hola, bienvenido a EMBAIR. ¿Qué materiales o insumos estás buscando hoy?"
  }
  
  return res.json({
    type: "unknown",
    text: fallback
  })
})

app.post("/api/chat/webhook", (req, res) => {
  res.json({ ok: true })
})

app.get("/api/chat/pending-replies/:platform", (req, res) => {
  res.json([])
})

const campaignsFile = path.join(dataDir, "campaigns.json")

app.get("/api/campaigns", requireAdmin, (req, res) => {
  const data = readData(campaignsFile)
  res.json(data)
})

app.post("/api/campaign/send", requireAdmin, async (req, res) => {
  const { subject, pdfUrl, emails, smtpConfig, publicUrl } = req.body
  
  if (!subject || !pdfUrl || !Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: "missing_fields" })
  }

  const campaignId = Date.now().toString()
  const campaign = {
    id: campaignId,
    date: new Date().toISOString(),
    subject,
    pdfUrl,
    total: emails.length,
    sent: 0,
    opens: {},
    clicks: {}
  }

  const campaigns = readData(campaignsFile)
  campaigns.unshift(campaign)
  writeData(campaignsFile, campaigns)

  let transporter
  if (smtpConfig && smtpConfig.host) {
    transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port || 587,
      secure: smtpConfig.secure || false,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass
      },
      tls: {
        rejectUnauthorized: false
      }
    })

    try {
      await transporter.verify()
    } catch (error) {
      console.error("SMTP Error:", error)
      const currentCampaigns = readData(campaignsFile)
      const filtered = currentCampaigns.filter(x => x.id !== campaignId)
      writeData(campaignsFile, filtered)
      
      return res.status(400).json({ 
        error: "smtp_error", 
        details: error.message,
        response: error.response 
      })
    }

  } else {
    console.log("No SMTP config provided. Simulating emails.")
    transporter = {
      sendMail: async (opts) => {
        console.log(`[SIMULATION] Email to ${opts.to}: Subject: ${opts.subject}`)
        return { messageId: "simulated-" + Date.now() }
      }
    }
  }

  const ip = getLocalIp()
  const port = process.env.PORT || 3002
  let baseUrl = publicUrl ? publicUrl.replace(/\/$/, "") : `http://${ip}:${port}`
  
  res.json({ ok: true, id: campaignId, status: "sending_started" })

  let sentCount = 0
  for (const email of emails) {
    const trackOpen = `${baseUrl}/api/track/open/${campaignId}/${encodeURIComponent(email)}`
    const trackLink = `${baseUrl}/api/track/link/${campaignId}/${encodeURIComponent(email)}`
    
    const html = `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2>${subject}</h2>
        <p>Hola,</p>
        <p>Adjunto encontrarás nuestra lista de precios actualizada.</p>
        <div style="background-color: #f3f4f6; padding: 10px; border-radius: 6px; font-size: 11px; color: #555; margin: 15px 0;">
            <strong>Nota:</strong> Si ves una pantalla de seguridad de "ngrok", presiona <strong>"Visit Site"</strong>.
        </div>
        <p style="margin: 20px 0;">
          <a href="${trackLink}" style="background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Descargar Lista de Precios
          </a>
        </p>
        <p style="font-size: 12px; color: #666; margin-top: 15px;">O copia este enlace: <br>${trackLink}</p>
        <img src="${trackOpen}" width="1" height="1" alt="" />
      </div>
    `

    try {
      await transporter.sendMail({
        from: smtpConfig?.from || '"Catálogo" <no-reply@example.com>',
        to: email,
        subject: subject,
        html: html
      })
      sentCount++
    } catch (err) {
      console.error(`Error sending to ${email}:`, err)
    }
  }
  
  const currentCampaigns = readData(campaignsFile)
  const c = currentCampaigns.find(x => x.id === campaignId)
  if (c) {
    c.sent = sentCount
    writeData(campaignsFile, currentCampaigns)
  }
})

app.get("/api/track/open/:id/:email", (req, res) => {
  const { id, email } = req.params
  const campaigns = readData(campaignsFile)
  const c = campaigns.find(x => x.id === id)
  if (c) {
    if (!c.opens) c.opens = {}
    if (!c.opens[email]) {
      c.opens[email] = new Date().toISOString()
      writeData(campaignsFile, campaigns)
    }
  }
  const img = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")
  res.writeHead(200, {
    "Content-Type": "image/gif",
    "Content-Length": img.length
  })
  res.end(img)
})

app.get("/api/leads", requireAdmin, (req, res) => {
  const list = readData(leadsFile)
  const sorted = list.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return tb - ta
  })
  res.json(sorted.slice(0, 1000))
})

app.post("/api/leads/convert", requireAdmin, (req, res) => {
  const { leadId } = req.body || {}
  const id = Number(leadId)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid_lead" })
  const leads = readData(leadsFile)
  const idx = leads.findIndex(l => Number(l && l.id) === id)
  if (idx < 0) return res.status(404).json({ error: "not_found" })
  const lead = leads[idx]
  if (lead && lead.convertedToClient && lead.clientId) return res.json({ ok: true, clientId: lead.clientId })
  if (!lead || !lead.celular) return res.status(400).json({ error: "missing_phone" })
  const client = upsertClientFromLead(lead)
  const now = new Date().toISOString()
  lead.convertedToClient = true
  lead.clientId = client.id
  lead.convertedAt = now
  leads[idx] = lead
  writeData(leadsFile, leads.slice(-5000))
  try {
    const events = readData(eventsFile)
    events.push({
      id: Date.now(),
      type: "lead_converted",
      sessionId: "",
      email: client.email || "",
      meta: { leadId: id, clientId: client.id },
      createdAt: now
    })
    writeData(eventsFile, events.slice(-5000))
  } catch {}
  res.json({ ok: true, clientId: client.id })
})

app.post("/api/public/lead", (req, res) => {
  const {
    nombre,
    apellido,
    cedula,
    email,
    celular,
    zona,
    tipo,
    direccion,
    entrega,
    interesado,
    source,
    campaignId,
    catalogId,
    sessionId,
    deviceId
  } = req.body || {}

  const src = String(source || "").trim()
  const emailKey = normalizeEmail(email)
  const phoneKey = normalizePhone(celular)
  const isCatalogFlow = /catalog/.test(src) || Boolean(catalogId)
  const isPortalFlow = src === "portal" || src === "portal_gate"

  if (!nombre || (!phoneKey && !emailKey)) {
    return res.status(400).json({ error: "missing_fields" })
  }

  if (isCatalogFlow || isPortalFlow) {
    if (!emailKey || !phoneKey || !String(cedula || "").trim() || !String(zona || "").trim() || !String(tipo || "").trim()) {
      return res.status(400).json({ error: "missing_fields" })
    }
  }

  const leads = readData(leadsFile)
  const now = new Date().toISOString()
  const ip = req.ip
  const ua = req.headers["user-agent"] || ""
  const cleanDeviceId = String(deviceId || "").trim()

  let lead = leads.find(l => matchByEmailOrPhone(l, emailKey, phoneKey)) || null

  if (!lead) {
    lead = {
      id: Date.now(),
      nombre: String(nombre || "").trim(),
      apellido: String(apellido || "").trim(),
      cedula: String(cedula || "").trim(),
      email: emailKey || "",
      celular: String(celular || "").trim(),
      direccion: String(direccion || "").trim(),
      entrega: String(entrega || "").trim(),
      zona: String(zona || "").trim(),
      tipo: String(tipo || "").trim(),
      interesado: Boolean(interesado),
      source: src || "",
      campaignId: campaignId || "",
      createdAt: now,
      lastSeenAt: now,
      visits: 1,
      convertedToClient: false,
      clientId: null,
      convertedAt: null,
      firstIp: ip || "",
      lastIp: ip || "",
      firstDeviceId: cleanDeviceId || "",
      lastDeviceId: cleanDeviceId || "",
      lastUserAgent: ua || ""
    }
    leads.push(lead)
  } else {
    if (nombre) lead.nombre = String(nombre || "").trim() || lead.nombre
    if (apellido) lead.apellido = String(apellido || "").trim() || lead.apellido
    if (cedula) lead.cedula = String(cedula || "").trim() || lead.cedula
    if (emailKey) lead.email = emailKey
    if (celular) lead.celular = String(celular || "").trim() || lead.celular
    if (direccion) lead.direccion = String(direccion || "").trim() || lead.direccion
    if (entrega) lead.entrega = String(entrega || "").trim() || lead.entrega
    if (zona) lead.zona = String(zona || "").trim() || lead.zona
    if (tipo) lead.tipo = String(tipo || "").trim() || lead.tipo
    if (typeof interesado === "boolean") lead.interesado = interesado
    if (src) lead.source = lead.source || src
    if (campaignId) lead.campaignId = lead.campaignId || campaignId
    lead.lastSeenAt = now
    lead.visits = typeof lead.visits === "number" ? lead.visits + 1 : 1
    if (!lead.firstIp && ip) lead.firstIp = ip
    if (ip) lead.lastIp = ip
    if (!lead.firstDeviceId && cleanDeviceId) lead.firstDeviceId = cleanDeviceId
    if (cleanDeviceId) lead.lastDeviceId = cleanDeviceId
    if (ua) lead.lastUserAgent = ua
  }

  const trimmedLeads = leads.slice(-5000)
  writeData(leadsFile, trimmedLeads)
  const events = readData(eventsFile)
  events.push({
    id: Date.now(),
    type: src && src.includes("assistant") ? "assistant_lead" : "lead_capture",
    sessionId: sessionId || "",
    email: lead.email || "",
    deviceId: cleanDeviceId || "",
    meta: {
      zona: lead.zona || "",
      tipo: lead.tipo || "",
      source: lead.source || "",
      campaignId: campaignId || "",
      catalogId: catalogId || ""
    },
    createdAt: now,
    ip,
    userAgent: ua
  })
  const trimmedEvents = events.slice(-5000)
  writeData(eventsFile, trimmedEvents)

  if (catalogId) {
    const list = readData(catalogsFile)
    const numId = Number(catalogId)
    const item = list.find(c => Number(c.id) === numId)
    if (item) {
      item.downloads = (item.downloads || 0) + 1
      item.lastDownloadAt = now
      item.lastDownloadEmail = lead.email || ""
      writeData(catalogsFile, list)
    }
    const events2 = readData(eventsFile)
    events2.push({
      id: Date.now(),
      type: "catalog_download_confirmed",
      sessionId: sessionId || "",
      email: lead.email || "",
      meta: { catalogId, source: src || "" },
      createdAt: now,
      ip,
      userAgent: ua
    })
    const trimmed2 = events2.slice(-5000)
    writeData(eventsFile, trimmed2)
  }

  res.json({ ok: true })
})

app.post("/api/public/client", (req, res) => {
  const { email, nombre, apellido, celular, zona, tipo, campaignId, catalogId, source, deviceId, sessionId } = req.body || {}
  if (!email) {
    return res.status(400).json({ error: "missing_email" })
  }

  const clients = readData(clientsFile)
  let client = clients.find(c => c.email === email)

  const now = new Date().toISOString()
  const ip = req.ip
  const ua = req.headers["user-agent"] || ""
  const cleanDeviceId = String(deviceId || "").trim()
  const safeNombre = nombre && String(nombre).trim() ? nombre : (client && client.nombre) || email.split("@")[0] || "Sin nombre"

  if (client) {
    client.nombre = safeNombre
    if (apellido) client.apellido = apellido
    if (celular) client.celular = celular
    if (zona) client.zona = zona
    if (tipo) client.tipo = tipo
    if (req.body.cedula) client.cedula = req.body.cedula
    if (req.body.direccion) client.direccion = req.body.direccion
    if (req.body.entrega) client.entrega = req.body.entrega
    client.updated_at = now
    if (!client.firstIp && ip) client.firstIp = ip
    if (ip) client.lastIp = ip
    if (!client.firstDeviceId && cleanDeviceId) client.firstDeviceId = cleanDeviceId
    if (cleanDeviceId) client.lastDeviceId = cleanDeviceId
    if (ua) client.lastUserAgent = ua
    client.lastSeenAt = now
    if (campaignId) {
      if (!client.campaigns) client.campaigns = []
      if (!client.campaigns.includes(campaignId)) client.campaigns.push(campaignId)
    }
  } else {
    client = {
      id: Date.now(),
      email,
      nombre: safeNombre,
      apellido: apellido || "",
      celular: celular || "",
      zona: zona || "",
      tipo: tipo || "",
      cedula: req.body.cedula || "",
      direccion: req.body.direccion || "",
      entrega: req.body.entrega || "",
      created_at: now,
      campaigns: campaignId ? [campaignId] : [],
      firstIp: ip || "",
      lastIp: ip || "",
      firstDeviceId: cleanDeviceId || "",
      lastDeviceId: cleanDeviceId || "",
      lastUserAgent: ua || "",
      lastSeenAt: now
    }
    clients.push(client)
  }
  writeData(clientsFile, clients)

  if (catalogId) {
    const list = readData(catalogsFile)
    const numId = Number(catalogId)
    const item = list.find(c => Number(c.id) === numId)
    if (item) {
      item.downloads = (item.downloads || 0) + 1
      item.lastDownloadAt = now
      item.lastDownloadEmail = email
      writeData(catalogsFile, list)
    }
    const events = readData(eventsFile)
    events.push({
      id: Date.now(),
      type: "catalog_download_confirmed",
      sessionId: "",
      email,
      meta: { catalogId, source: source || "" },
      createdAt: now,
      ip,
      userAgent: ua,
      deviceId: cleanDeviceId || ""
    })
    const trimmed = events.slice(-5000)
    writeData(eventsFile, trimmed)
  }

  try {
    const leads = readData(leadsFile)
    const emailLower = normalizeEmail(email)
    const phoneKey = normalizePhone(client && client.celular)
    let updated = false
    leads.forEach(l => {
      if (l.convertedToClient) return
      if (matchByEmailOrPhone(l, emailLower, phoneKey)) {
        l.convertedToClient = true
        l.clientId = client.id
        l.convertedAt = now
        updated = true
      }
    })
    if (updated) {
      const trimmedLeads = leads.slice(-5000)
      writeData(leadsFile, trimmedLeads)
    }
  } catch {}

  res.json({ ok: true })
})

app.post("/api/portal/register", async (req, res) => {
  const { email, nombre, apellido, cedula, celular, zona, tipo } = req.body
  if (!email || !nombre || !cedula || !celular) {
    return res.status(400).json({ error: "missing_fields" })
  }

  const list = readData(clientsFile)
  const now = new Date().toISOString()

  let client = list.find(c => c.email && c.email.toLowerCase() === String(email).toLowerCase())

  if (!client) {
    const newId = list.length ? Math.max(...list.map(x => x.id || 0)) + 1 : 1
    client = { id: newId }
    list.push(client)
  }

  client.email = email
  client.nombre = nombre
  client.apellido = apellido || client.apellido || ""
  client.cedula = cedula || client.cedula || ""
  client.celular = celular
  client.zona = zona || client.zona || ""
  client.tipo = tipo || client.tipo || ""
  client.portalRequestedAt = client.portalRequestedAt || now
  client.portalApproved = typeof client.portalApproved === "boolean" ? client.portalApproved : false

  writeData(clientsFile, list)

  const events = readData(eventsFile)
  events.push({
    id: Date.now(),
    type: "portal_register",
    sessionId: "",
    email,
    meta: { zona, tipo },
    createdAt: now
  })
  const trimmed = events.slice(-5000)
  writeData(eventsFile, trimmed)

  return res.json({ ok: true })
})

// --- AUTH / GATE CHECK ---
app.post("/api/auth/check", (req, res) => {
  const { phone, deviceId, sessionId } = req.body || {}
  if (!phone) return res.status(400).json({ error: "missing_phone" })
  
  const cleanPhone = String(phone).replace(/\D/g, "")
  if (cleanPhone.length < 8) return res.json({ exists: false })
  const cleanDeviceId = String(deviceId || "").trim()
  const cleanSessionId = String(sessionId || "").trim()
  const now = new Date().toISOString()
  const ip = req.ip
  const ua = req.headers["user-agent"] || ""
  
  const clients = readData(clientsFile)
  const client = clients.find(c => String(c.celular || "").replace(/\D/g, "").includes(cleanPhone))
  
  if (client) {
    let changed = false
    if (cleanDeviceId) {
      if (!client.firstDeviceId) { client.firstDeviceId = cleanDeviceId; changed = true }
      if (client.lastDeviceId && client.lastDeviceId !== cleanDeviceId) {
        const events = readData(eventsFile)
        events.unshift({
          id: Date.now().toString(),
          createdAt: now,
          type: "portal_phone_device_mismatch",
          sessionId: cleanSessionId,
          email: client.email || "",
          deviceId: cleanDeviceId,
          meta: { kind: "client", phoneLast4: cleanPhone.slice(-4), prevDeviceId: client.lastDeviceId },
          ip,
          userAgent: ua
        })
        if (events.length > 1000) events.length = 1000
        writeData(eventsFile, events)
      }
      if (client.lastDeviceId !== cleanDeviceId) { client.lastDeviceId = cleanDeviceId; changed = true }
    }
    if (ip && client.lastIp !== ip) { client.lastIp = ip; changed = true }
    if (!client.firstIp && ip) { client.firstIp = ip; changed = true }
    if (ua && client.lastUserAgent !== ua) { client.lastUserAgent = ua; changed = true }
    client.portalLastCheckAt = now
    client.portalCheckCount = typeof client.portalCheckCount === "number" ? client.portalCheckCount + 1 : 1
    changed = true
    if (changed) writeData(clientsFile, clients)
    return res.json({
      exists: true,
      type: "client",
      data: {
        nombre: client.nombre,
        apellido: client.apellido,
        cedula: client.cedula,
        direccion: client.direccion,
        zona: client.zona,
        celular: client.celular,
        email: client.email,
        tipo: client.tipo,
        entrega: client.entrega
      }
    })
  }
  
  const leads = readData(leadsFile)
  const lead = leads.find(l => String(l.celular || "").replace(/\D/g, "").includes(cleanPhone))
  
  if (lead) {
     let changed = false
     if (cleanDeviceId) {
       if (!lead.firstDeviceId) { lead.firstDeviceId = cleanDeviceId; changed = true }
       if (lead.lastDeviceId && lead.lastDeviceId !== cleanDeviceId) {
         const events = readData(eventsFile)
         events.unshift({
           id: Date.now().toString(),
           createdAt: now,
           type: "portal_phone_device_mismatch",
           sessionId: cleanSessionId,
           email: lead.email || "",
           deviceId: cleanDeviceId,
           meta: { kind: "lead", phoneLast4: cleanPhone.slice(-4), prevDeviceId: lead.lastDeviceId },
           ip,
           userAgent: ua
         })
         if (events.length > 1000) events.length = 1000
         writeData(eventsFile, events)
       }
       if (lead.lastDeviceId !== cleanDeviceId) { lead.lastDeviceId = cleanDeviceId; changed = true }
     }
     if (ip && lead.lastIp !== ip) { lead.lastIp = ip; changed = true }
     if (!lead.firstIp && ip) { lead.firstIp = ip; changed = true }
     if (ua && lead.lastUserAgent !== ua) { lead.lastUserAgent = ua; changed = true }
     lead.portalLastCheckAt = now
     lead.portalCheckCount = typeof lead.portalCheckCount === "number" ? lead.portalCheckCount + 1 : 1
     changed = true
     if (changed) writeData(leadsFile, leads)
     return res.json({
      exists: true,
      type: "lead",
      data: {
        nombre: lead.nombre,
        apellido: lead.apellido || "",
        cedula: lead.cedula || "",
        direccion: lead.direccion || "",
        entrega: lead.entrega || "",
        email: lead.email,
        celular: lead.celular,
        zona: lead.zona,
        tipo: lead.tipo
      }
    })
  }
  
  return res.json({ exists: false })
})

app.post("/api/portal/admin/set-password", requireAdmin, (req, res) => {
  const { clientId, password } = req.body || {}
  if (!clientId || !password) {
    return res.status(400).json({ error: "missing_fields" })
  }
  const list = readData(clientsFile)
  const client = list.find(c => c.id === Number(clientId))
  if (!client) {
    return res.status(404).json({ error: "client_not_found" })
  }
  client.portalPasswordHash = hashPassword(String(password))
  client.portalApproved = true
  const now = new Date().toISOString()
  client.portalApprovedAt = now
  const events = readData(eventsFile)
  events.push({
    id: Date.now(),
    type: "portal_approved",
    sessionId: "",
    email: client.email || "",
    meta: { clientId: client.id },
    createdAt: now
  })
  const trimmed = events.slice(-5000)
  writeData(eventsFile, trimmed)
  writeData(clientsFile, list)
  return res.json({ ok: true })
})

app.post("/api/portal/login", (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: "missing_fields" })
  }

  const list = readData(clientsFile)
  const client = list.find(c => c.email && c.email.toLowerCase() === String(email).toLowerCase())

  if (!client || !client.portalPasswordHash) {
    return res.status(404).json({ error: "not_found" })
  }

  const pwdHash = hashPassword(password)
  if (client.portalPasswordHash !== pwdHash) {
    return res.status(401).json({ error: "invalid_credentials" })
  }

  const now = new Date().toISOString()
  client.portalLastLoginAt = now
  client.portalLoginCount = typeof client.portalLoginCount === "number" ? client.portalLoginCount + 1 : 1

  writeData(clientsFile, list)

  const events = readData(eventsFile)
  events.push({
    id: Date.now(),
    type: "portal_login",
    sessionId: "",
    email,
    meta: { zona: client.zona || "", tipo: client.tipo || "" },
    createdAt: now
  })
  const trimmed = events.slice(-5000)
  writeData(eventsFile, trimmed)

  return res.json({
    ok: true,
    client: {
      id: client.id,
      email: client.email,
      nombre: client.nombre,
      apellido: client.apellido,
      celular: client.celular,
      zona: client.zona || "",
      tipo: client.tipo || ""
    }
  })
})

function getClientFromRequest(req) {
  try {
    const auth = req.headers["x-client-auth"] || req.headers.authorization || ""
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : auth
    const decoded = Buffer.from(bearer || "", "base64").toString("utf8")
    const parts = decoded.split(":")
    if (parts.length < 2) return null
    const clientId = Number(parts[0])
    const email = String(parts[1] || "").toLowerCase()
    if (!Number.isFinite(clientId) || !email) return null
    const list = readData(clientsFile)
    const c = list.find(x => Number(x.id) === clientId && String(x.email || "").toLowerCase() === email)
    return c || null
  } catch {
    return null
  }
}

function requireClient(req, res, next) {
  const c = getClientFromRequest(req)
  if (!c) return res.status(401).json({ error: "unauthorized_client" })
  req.client = c
  return next()
}

// --- CARTS (CLIENT) ---
function getActiveCart(clientId) {
  const carts = readData(cartsFile)
  return carts.find(c => Number(c.clientId) === Number(clientId) && String(c.status || "active") === "active") || null
}

function ensureActiveCart(clientId) {
  const carts = readData(cartsFile)
  let cart = carts.find(c => Number(c.clientId) === Number(clientId) && String(c.status || "active") === "active")
  const now = new Date().toISOString()
  if (!cart) {
    cart = {
      id: Date.now().toString() + "-" + Math.random().toString(36).slice(2, 6),
      clientId: Number(clientId),
      status: "active",
      items: [],
      notes: "",
      createdAt: now,
      updatedAt: now
    }
    carts.push(cart)
    writeData(cartsFile, carts)
  }
  return cart
}

function enrichCart(cart) {
  if (!cart) return null
  const products = readData(productsFile)
  const items = Array.isArray(cart.items) ? cart.items : []
  let subtotal = 0
  const withProduct = items.map(i => {
    const p = products.find(x => Number(x.id) === Number(i.productId)) || null
    const unitPrice = Number(i.unitPrice ?? (p && p.price) ?? 0)
    const qty = Math.max(1, Number(i.qty || 1))
    subtotal += unitPrice * qty
    return {
      productId: Number(i.productId),
      qty,
      unitPrice,
      name: p ? p.name : (i.name || "Producto"),
      img: p ? (p.img || "") : (i.img || ""),
      category: p ? (p.category || "") : ""
    }
  })
  return { ...cart, items: withProduct, subtotal }
}

app.get("/api/client/cart", requireClient, (req, res) => {
  const c = getActiveCart(req.client.id)
  res.json({ ok: true, cart: enrichCart(c) })
})

app.post("/api/client/cart/item", requireClient, (req, res) => {
  const { productId, qty } = req.body || {}
  const pid = Number(productId)
  const q = Math.max(1, Number(qty || 1))
  if (!Number.isFinite(pid) || pid <= 0) return res.status(400).json({ error: "invalid_product" })
  const carts = readData(cartsFile)
  const cart = ensureActiveCart(req.client.id)
  const idx = carts.findIndex(x => x.id === cart.id)
  if (idx < 0) return res.status(500).json({ error: "cart_missing" })
  const working = carts[idx]
  const products = readData(productsFile)
  const p = products.find(x => Number(x.id) === pid)
  const item = (Array.isArray(working.items) ? working.items : []).find(i => Number(i.productId) === pid)
  if (item) {
    item.qty = q
    if (p && p.price != null) item.unitPrice = Number(p.price)
  } else {
    if (!working.items) working.items = []
    working.items.push({
      productId: pid,
      qty: q,
      unitPrice: p && p.price != null ? Number(p.price) : 0,
      name: p ? p.name : "",
      img: p ? (p.img || "") : ""
    })
  }
  working.updatedAt = new Date().toISOString()
  writeData(cartsFile, carts)
  const events = readData(eventsFile)
  events.push({ id: Date.now().toString(), type: "cart_item_add", sessionId: "", email: req.client.email || "", meta: { productId: pid, qty: q, clientId: req.client.id }, createdAt: new Date().toISOString(), ip: req.ip })
  writeData(eventsFile, events.slice(-5000))
  res.json({ ok: true, cart: enrichCart(working) })
})

app.post("/api/client/cart/item/remove", requireClient, (req, res) => {
  const { productId } = req.body || {}
  const pid = Number(productId)
  if (!Number.isFinite(pid) || pid <= 0) return res.status(400).json({ error: "invalid_product" })
  const carts = readData(cartsFile)
  const cart = getActiveCart(req.client.id)
  if (!cart) return res.json({ ok: true, cart: null })
  const idx = carts.findIndex(x => x.id === cart.id)
  carts[idx].items = (carts[idx].items || []).filter(i => Number(i.productId) !== pid)
  carts[idx].updatedAt = new Date().toISOString()
  writeData(cartsFile, carts)
  res.json({ ok: true, cart: enrichCart(carts[idx]) })
})

app.post("/api/client/cart/clear", requireClient, (req, res) => {
  const carts = readData(cartsFile)
  const cart = getActiveCart(req.client.id)
  if (cart) {
    const idx = carts.findIndex(x => x.id === cart.id)
    carts[idx].items = []
    carts[idx].updatedAt = new Date().toISOString()
    writeData(cartsFile, carts)
    return res.json({ ok: true, cart: enrichCart(carts[idx]) })
  }
  res.json({ ok: true, cart: null })
})

app.post("/api/client/cart/order", requireClient, (req, res) => {
  const carts = readData(cartsFile)
  const cart = getActiveCart(req.client.id)
  if (!cart || !cart.items || cart.items.length === 0) {
    return res.status(400).json({ error: "empty_cart" })
  }
  const idx = carts.findIndex(x => x.id === cart.id)
  const enriched = enrichCart(cart)
  const total = Number(enriched.subtotal || 0)
  const now = new Date().toISOString()
  const order = {
    id: Date.now().toString(),
    createdAt: now,
    updatedAt: now,
    status: "new",
    client: {
      id: req.client.id,
      name: `${req.client.nombre || ""} ${req.client.apellido || ""}`.trim(),
      email: req.client.email || "",
      phone: req.client.celular || "",
      zona: req.client.zona || "",
      tipo: req.client.tipo || "",
      address: req.client.direccion || "",
      entrega: req.client.entrega || ""
    },
    items: enriched.items.map(i => ({
      productId: i.productId,
      name: i.name,
      qty: i.qty,
      unitPrice: i.unitPrice,
      subtotal: i.qty * i.unitPrice
    })),
    total,
    source: "portal_cart",
    cartId: cart.id,
    paymentMethod: "",
    deliveryMethod: req.body && req.body.deliveryMethod ? String(req.body.deliveryMethod) : "",
    notes: req.body && req.body.notes ? String(req.body.notes) : (cart.notes || "")
  }
  const orders = readData(ordersFile)
  orders.unshift(order)
  writeData(ordersFile, orders)
  carts[idx].status = "ordered"
  carts[idx].orderedAt = now
  carts[idx].orderId = order.id
  carts[idx].updatedAt = now
  writeData(cartsFile, carts)
  const clients = readData(clientsFile)
  const ci = clients.findIndex(x => Number(x.id) === Number(req.client.id))
  if (ci >= 0) {
    clients[ci].pedidos = (typeof clients[ci].pedidos === "number" ? clients[ci].pedidos : 0) + 1
    clients[ci].updated_at = now
    writeData(clientsFile, clients)
  }
  const events = readData(eventsFile)
  events.push({ id: Date.now().toString(), type: "order_from_cart", sessionId: "", email: req.client.email || "", meta: { orderId: order.id, total, clientId: req.client.id }, createdAt: now, ip: req.ip })
  writeData(eventsFile, events.slice(-5000))
  res.json({ ok: true, orderId: order.id, order })
})

// --- CRM / ADMIN ---
app.get("/api/admin/clients/:id/cart", requireAdmin, (req, res) => {
  const clientId = Number(req.params.id)
  if (!Number.isFinite(clientId)) return res.status(400).json({ error: "invalid_client" })
  const cart = getActiveCart(clientId)
  res.json({ ok: true, cart: enrichCart(cart) })
})

app.get("/api/admin/carts", requireAdmin, (req, res) => {
  const carts = readData(cartsFile)
  const { abandoned } = req.query
  const nowMs = Date.now()
  const result = carts
    .filter(c => {
      if (!c) return false
      if (String(abandoned) === "true") {
        if (String(c.status || "active") !== "active") return false
        const h = Number(c.updatedAt ? new Date(c.updatedAt).getTime() : 0)
        return nowMs - h > 20 * 60 * 60 * 1000
      }
      return true
    })
    .map(enrichCart)
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  res.json({ ok: true, carts: result })
})

app.get("/api/admin/tasks", requireAdmin, (req, res) => {
  const list = readData(tasksFile)
  const { clientId } = req.query
  let out = list.slice()
  if (clientId) out = out.filter(t => Number(t.clientId) === Number(clientId))
  out.sort((a, b) => {
    const da = a.dueAt ? new Date(a.dueAt).getTime() : Infinity
    const db = b.dueAt ? new Date(b.dueAt).getTime() : Infinity
    if (da !== db) return da - db
    return new Date(b.createdAt) - new Date(a.createdAt)
  })
  res.json({ ok: true, tasks: out })
})

app.post("/api/admin/tasks", requireAdmin, (req, res) => {
  const { title, clientId, leadId, dueAt, assignee, notes, kind } = req.body || {}
  if (!title || !String(title).trim()) return res.status(400).json({ error: "title_required" })
  const tasks = readData(tasksFile)
  const now = new Date().toISOString()
  const task = {
    id: Date.now().toString() + "-" + Math.random().toString(36).slice(2, 6),
    title: String(title).trim(),
    clientId: clientId ? Number(clientId) : null,
    leadId: leadId ? Number(leadId) : null,
    kind: String(kind || "general"),
    dueAt: dueAt ? String(dueAt) : "",
    assignee: String(assignee || ""),
    notes: String(notes || ""),
    done: false,
    createdAt: now,
    updatedAt: now
  }
  tasks.push(task)
  writeData(tasksFile, tasks)
  res.json({ ok: true, task })
})

app.put("/api/admin/tasks/:id", requireAdmin, (req, res) => {
  const { id } = req.params
  const tasks = readData(tasksFile)
  const t = tasks.find(x => x.id === id)
  if (!t) return res.status(404).json({ error: "not_found" })
  const fields = ["title", "dueAt", "assignee", "notes", "done", "kind"]
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) t[f] = req.body[f]
  }
  t.updatedAt = new Date().toISOString()
  writeData(tasksFile, tasks)
  res.json({ ok: true, task: t })
})

app.delete("/api/admin/tasks/:id", requireAdmin, (req, res) => {
  const { id } = req.params
  const tasks = readData(tasksFile)
  const before = tasks.length
  const filtered = tasks.filter(x => x.id !== id)
  if (filtered.length === before) return res.status(404).json({ error: "not_found" })
  writeData(tasksFile, filtered)
  res.json({ ok: true })
})

app.get("/api/crm/orders", requireAdmin, (req, res) => {
  const data = readData(ordersFile)
  data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  res.json(data)
})

app.post("/api/crm/orders", (req, res) => {
  const { client, items, total, source, paymentMethod, deliveryMethod, notes } = req.body
  const now = new Date().toISOString()
  
  const order = {
    id: Date.now().toString(),
    createdAt: now,
    updatedAt: now,
    status: "new",
    client: client || {},
    items: items || [],
    total: total || 0,
    source: source || "web",
    paymentMethod: paymentMethod || "",
    deliveryMethod: deliveryMethod || "",
    notes: notes || ""
  }
  
  const orders = readData(ordersFile)
  orders.unshift(order)
  writeData(ordersFile, orders)
  
  const events = readData(eventsFile)
  events.push({
    id: Date.now().toString(),
    type: "new_order",
    meta: { orderId: order.id, total: order.total },
    createdAt: now,
    ip: req.ip
  })
  const trimmed = events.slice(-5000)
  writeData(eventsFile, trimmed)

  try {
    const c = client || {}
    const emailKey = normalizeEmail(c.email)
    const phoneKey = normalizePhone(c.phone || c.celular)
    if (emailKey || phoneKey) {
      const clients = readData(clientsFile)
      let found = null
      for (const it of clients) {
        if (emailKey && normalizeEmail(it.email) === emailKey) { found = it; break }
        if (!found && phoneKey && matchByEmailOrPhone(it, "", phoneKey)) found = it
      }
      if (!found) {
        const newId = clients.length ? Math.max(...clients.map(x => Number(x.id) || 0)) + 1 : 1
        found = { id: newId, created_at: now }
        clients.push(found)
      }
      const fullName = String(c.name || "").trim()
      if (fullName && !found.nombre) found.nombre = fullName
      if (emailKey) found.email = emailKey
      if (phoneKey) found.celular = String(c.phone || c.celular || "").trim()
      if (c.zona) found.zona = String(c.zona || "").trim()
      if (c.address && !found.direccion) found.direccion = String(c.address || "").trim()
      found.updated_at = now
      found.interesado = true
      found.pedidos = (typeof found.pedidos === "number" ? found.pedidos : 0) + 1
      writeData(clientsFile, clients)
      try {
        const leads = readData(leadsFile)
        let updated = false
        leads.forEach(l => {
          if (l.convertedToClient) return
          if (matchByEmailOrPhone(l, emailKey, phoneKey)) {
            l.convertedToClient = true
            l.clientId = found.id
            l.convertedAt = now
            updated = true
          }
        })
        if (updated) writeData(leadsFile, leads.slice(-5000))
      } catch {}
    }
  } catch {}
  
  res.json({ ok: true, orderId: order.id })
})

app.get("/api/bot/check-stock", (req, res) => {
  const { q, code } = req.query
  if (!q && !code) return res.status(400).json({ error: "missing_query" })
  
  const products = readData(productsFile)
  let results = []
  
  if (code) {
    const p = products.find(x => x.code === code)
    if (p) results.push(p)
  } else if (q) {
    const term = String(q).toLowerCase()
    const primary = products.filter(p => {
      const hay = (p.name + " " + (p.desc || "") + " " + (p.category || "")).toLowerCase()
      return hay.includes(term)
    })
    results = primary.slice(0, 5)
    if (results.length < 5) {
      const complement = products.filter(p => {
        if (results.some(x => x && x.id != null && p && p.id != null && x.id === p.id)) return false
        const tags = Array.isArray(p.tags) ? p.tags.join(" ") : (p.tags || "")
        return String(tags || "").toLowerCase().includes(term)
      })
      results = results.concat(complement.slice(0, 5 - results.length))
    }
  }
  
  res.json({
    ok: true,
    count: results.length,
    products: results.map(p => ({
      id: p.id,
      code: p.code,
      name: p.name,
      price: p.price,
      stock: p.available || "Consultar",
      category: p.category
    }))
  })
})

app.put("/api/crm/orders/:id", requireAdmin, (req, res) => {
  const { id } = req.params
  const updates = req.body
  const orders = readData(ordersFile)
  const order = orders.find(o => o.id === id)
  
  if (!order) return res.status(404).json({ error: "not_found" })
  
  Object.assign(order, updates)
  order.updatedAt = new Date().toISOString()
  
  writeData(ordersFile, orders)
  res.json({ ok: true })
})

app.delete("/api/crm/orders/:id", requireAdmin, (req, res) => {
    const { id } = req.params
    let orders = readData(ordersFile)
    const initialLen = orders.length
    orders = orders.filter(o => o.id !== id)
    if (orders.length === initialLen) return res.status(404).json({ error: "not_found" })
    
    writeData(ordersFile, orders)
    res.json({ ok: true })
})

app.post("/api/campaign/public", requireAdmin, (req, res) => {
  const { subject, pdfUrl, publicUrl } = req.body
  if (!subject || !pdfUrl) return res.status(400).json({ error: "missing_fields" })

  const campaignId = "qr-" + Date.now().toString()
  const campaign = {
    id: campaignId,
    date: new Date().toISOString(),
    subject,
    pdfUrl,
    total: 0,
    sent: 0,
    opens: {},
    clicks: {},
    type: "qr"
  }
  
  const campaigns = readData(campaignsFile)
  campaigns.unshift(campaign)
  writeData(campaignsFile, campaigns)

  const ip = getLocalIp()
  const port = process.env.PORT || 3002
  let baseUrl = publicUrl ? publicUrl.replace(/\/$/, "") : `http://${ip}:${port}`
  
  res.json({ 
      ok: true, 
      id: campaignId, 
      link: `${baseUrl}/api/public/go/${campaignId}` 
  })
})

app.get("/api/public/go/:id", (req, res) => {
    const { id } = req.params
    const campaigns = readData(campaignsFile)
    const c = campaigns.find(x => x.id === id)
    if (c) {
        const redirectUrl = `/download.html?cid=${encodeURIComponent(id)}&pdf=${encodeURIComponent(c.pdfUrl)}`
        return res.redirect(redirectUrl)
    }
    res.status(404).send("Link not found")
})

app.get("/api/track/link/:id/:email", (req, res) => {
  const { id, email } = req.params
  const campaigns = readData(campaignsFile)
  const c = campaigns.find(x => x.id === id)
  if (c) {
    if (!c.clicks) c.clicks = {}
    if (!c.clicks[email]) {
      c.clicks[email] = new Date().toISOString()
      writeData(campaignsFile, campaigns)
    }
    const redirectUrl = `/download.html?email=${encodeURIComponent(email)}&cid=${encodeURIComponent(id)}&pdf=${encodeURIComponent(c.pdfUrl)}`
    return res.redirect(redirectUrl)
  }
  res.status(404).send("Campaign not found")
})

app.post("/api/smtp/test", requireAdmin, async (req, res) => {
  const { smtpConfig } = req.body
  if (!smtpConfig || !smtpConfig.host) {
    return res.status(400).json({ error: "missing_config" })
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port || 587,
      secure: smtpConfig.secure || false,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass
      },
      tls: {
        rejectUnauthorized: false
      }
    })

    await transporter.verify()
    res.json({ ok: true })
  } catch (error) {
    console.error("SMTP Test Error:", error)
    res.status(400).json({ 
      error: "smtp_error", 
      details: error.message,
      response: error.response 
    })
  }
})

app.get("/api/catalogs", requireAdmin, (req, res) => {
  const list = readData(catalogsFile)
  res.json(list)
})

app.post("/api/catalogs", requireAdmin, (req, res) => {
  const { id, title, url } = req.body || {}
  if (!title || !url) {
    return res.status(400).json({ error: "missing_fields" })
  }
  const list = readData(catalogsFile)
  const now = new Date().toISOString()
  let item = null
  if (id) {
    const numId = Number(id)
    const idx = list.findIndex(c => Number(c.id) === numId)
    if (idx >= 0) {
      item = list[idx]
      item.title = title
      item.url = url
      item.updatedAt = now
    }
  }
  if (!item) {
    const newId = list.length ? Math.max(...list.map(x => Number(x.id) || 0)) + 1 : 1
    item = { id: newId, title, url, createdAt: now }
    list.push(item)
  }
  writeData(catalogsFile, list)
  res.json({ ok: true, item })
})

app.delete("/api/catalogs/:id", requireAdmin, (req, res) => {
  const { id } = req.params
  const list = readData(catalogsFile)
  const numId = Number(id)
  const filtered = list.filter(c => Number(c.id) !== numId)
  writeData(catalogsFile, filtered)
  res.json({ ok: true })
})

app.get("/api/public/catalogs", (req, res) => {
  const list = readData(catalogsFile)
  res.json(list)
})

function requireExternalApiKey(req, res, next) {
  const expected = process.env.EXTERNAL_API_KEY
  if (!expected) {
    return res.status(500).json({ error: "api_key_not_configured" })
  }
  const provided = req.headers["x-api-key"]
  if (!provided || String(provided) !== String(expected)) {
    return res.status(401).json({ error: "unauthorized" })
  }
  next()
}

function findBestProductMatchForText(text, products) {
  const q = String(text || "").toLowerCase()
  const list = Array.isArray(products) ? products : []
  let best = null
  let bestScore = 0
  for (const p of list) {
    const name = String(p.name || "").toLowerCase()
    const tags = Array.isArray(p.tags) ? p.tags.join(" ") : (p.tags || "")
    const hay = `${p.name || ""} ${p.desc || ""} ${tags}`.toLowerCase()
    let score = 0
    const words = q.split(/\s+/).filter(Boolean)
    for (const w of words) {
      if (!w) continue
      if (name.includes(w)) score += 3
      if (hay.includes(w)) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }
  if (bestScore === 0) return null
  return best
}

function recommendProductsForQueryText(query, products) {
  const q = String(query || "").toLowerCase()
  const words = q.split(/\s+/).filter(Boolean)
  const list = Array.isArray(products) ? products : []
  const filtered = []
  for (const p of list) {
    if (p.available && p.available !== "Disponible") continue
    const tags = Array.isArray(p.tags) ? p.tags.join(" ") : (p.tags || "")
    const hay = `${p.name || ""} ${p.desc || ""} ${p.category || ""} ${p.subcategory || ""} ${p.material || ""} ${p.brand || ""} ${tags}`.toLowerCase()
    let score = 0
    if (!words.length) score += 1
    for (const w of words) {
      if (hay.includes(w)) score += 3
    }
    if (/lámpara|lampara|iluminación|iluminacion|foco|bombillo/.test(q) && p.category === "Electricidad") score += 4
    if (/tubo|agua|llave|grifo|grifería|griferia|sifón|sifon/.test(q) && p.category === "Plomería") score += 4
    if (p.price != null) {
      const val = Number(p.price)
      if (!Number.isNaN(val)) score += Math.min(val / 1000, 5)
    }
    if (score > 0) {
      filtered.push({ p, score })
    }
  }
  filtered.sort((a, b) => b.score - a.score)
  return filtered.slice(0, 4).map(x => x.p)
}

function buildAssistantReplyForWhatsApp(message, products) {
  const text = String(message || "").trim()
  if (!text) {
    return "Hola, soy tu asistente de compras de EMBAIR. Cuéntame qué necesitas y buscaré productos en el catálogo mayorista para ayudarte."
  }
  const lower = text.toLowerCase()
  if (/tablero/.test(lower) && !/empotrado|superficie|m[oó]dulo|modulo/.test(lower)) {
    return "Para ayudarte mejor con tableros, indícame si lo necesitas empotrado o de superficie y para cuántos módulos aproximadamente."
  }
  const productsList = Array.isArray(products) ? products : []
  if (!productsList.length) {
    return "Por ahora no tengo productos cargados en el catálogo. Intenta de nuevo más tarde o contacta directamente con un asesor."
  }
  if (/disponible|tienes|tienen|hay|stock/.test(lower)) {
    const prod = findBestProductMatchForText(text, productsList)
    if (prod) {
      if (prod.available && prod.available !== "Disponible") {
        const altQuery = `${prod.category || ""} ${prod.subcategory || ""}`
        const recsAlt = recommendProductsForQueryText(altQuery, productsList)
        let msg = `Ese producto figura como *agotado* en el catálogo: *${prod.name}*.\n`
        if (recsAlt.length) {
          msg += "\n*Opciones alternativas que podrían servirte:*\n"
          for (const r of recsAlt) {
            const parts = []
            if (r.category) parts.push(r.category)
            if (r.subcategory) parts.push(r.subcategory)
            if (r.material) parts.push(r.material)
            const desc = parts.length ? ` (${parts.join(" • ")})` : ""
            let priceText = ""
            if (r.price != null && !Number.isNaN(Number(r.price))) {
              priceText = ` - Precio aprox: $${Number(r.price).toLocaleString("es-VE")}`
            } else {
              priceText = " - Precio: solicitar cotización"
            }
            msg += `• *${r.name}*${desc}${priceText}\n`
          }
        } else {
          msg += "\nSi quieres puedo buscarte alternativas similares si me das más detalles."
        }
        return msg
      }
      return `Sí, en el catálogo figura como *disponible*: *${prod.name}*.\n\nPuedes buscarlo por nombre o código en la app mayorista o indicarme si quieres que te sugiera complementos.`
    }
  }
  const recs = recommendProductsForQueryText(text, productsList)
  if (!recs.length) {
    return "Con lo que me cuentas no encontré algo claro en el catálogo. Prueba explicando qué ambiente o instalación quieres armar (por ejemplo: iluminación de sala, cambio de grifería de baño, tablero para apartamento)."
  }
  let msg = "*Te sugiero estos productos según lo que comentas:*\n\n"
  for (const p of recs) {
    const parts = []
    if (p.category) parts.push(p.category)
    if (p.subcategory) parts.push(p.subcategory)
    if (p.material) parts.push(p.material)
    const desc = parts.length ? ` (${parts.join(" • ")})` : ""
    let priceText = ""
    if (p.price != null && !Number.isNaN(Number(p.price))) {
      priceText = ` - Precio aprox: $${Number(p.price).toLocaleString("es-VE")}`
    } else {
      priceText = " - Precio: solicitar cotización"
    }
    msg += `• *${p.name}*${desc}${priceText}\n`
  }
  msg += "\nSi te interesa alguno, responde con el nombre o código y te ayudo a afinar la lista."
  return msg
}

app.post("/api/external/chat", requireExternalApiKey, (req, res) => {
  const { mensaje, telefono } = req.body || {}
  if (!mensaje) {
    return res.status(400).json({ error: "missing_mensaje" })
  }
  const products = readData(productsFile)
  const respuesta = buildAssistantReplyForWhatsApp(mensaje, products)
  res.json({ respuesta_ia: respuesta })
})

function getLocalIp() {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address
      }
    }
  }
  return "localhost"
}

ensurePortalTestClient()

const port = process.env.PORT || 3002
app.listen(port, "0.0.0.0", () => {
  const ip = getLocalIp()
  console.log(`Server on http://localhost:${port}`)
  console.log(`Network access: http://${ip}:${port}`)
})
