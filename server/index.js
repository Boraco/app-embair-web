import express from "express"
import dotenv from "dotenv"
import rateLimit from "express-rate-limit"
import path from "path"
import { fileURLToPath } from "url"
import fs from "fs"
import multer from "multer"
import nodemailer from "nodemailer"
import crypto from "crypto"
// DB y notificaciones deshabilitados para entorno de prueba de catálogo

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(express.json())

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60
})
app.use(limiter)

function requireAdmin(req, res, next) {
  const user = process.env.ADMIN_USER || "admin"
  const pass = process.env.ADMIN_PASS || "admin"
  const header = req.headers.authorization || ""
  const token = header.split(" ")[1] || ""
  const decoded = Buffer.from(token || "", "base64").toString()
  const [u, p] = decoded.split(":")
  if (u === user && p === pass) return next()
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

app.use(express.static(path.join(__dirname, "..", "public")))

app.get("/app", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"))
})

app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"))
})

// Endpoints de agenda y clientes deshabilitados temporalmente

const uploadDir = path.join(__dirname, "..", "public", "uploads")
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

const dataDir = path.join(__dirname, "..", "data")
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

const productsFile = path.join(dataDir, "products.json")
const clientsFile = path.join(dataDir, "clients.json")
const catalogsFile = path.join(dataDir, "catalogs.json")

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

app.get("/api/config", (req, res) => {
  const data = readData(configFile)
  // Return default if empty
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
    opens: {}, // email -> timestamp
    clicks: {} // email -> timestamp
  }

  // Save initial
  const campaigns = readData(campaignsFile)
  campaigns.unshift(campaign)
  writeData(campaignsFile, campaigns)

  // Configure Transporter
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

    // Verify SMTP connection before proceeding
    try {
      await transporter.verify()
    } catch (error) {
      console.error("SMTP Error:", error)
      // Remove the failed campaign entry since we are aborting
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
    // Simulation / Log mode
    console.log("No SMTP config provided. Simulating emails.")
    transporter = {
      sendMail: async (opts) => {
        console.log(`[SIMULATION] Email to ${opts.to}: Subject: ${opts.subject}`)
        return { messageId: "simulated-" + Date.now() }
      }
    }
  }

  // Send in background (don't wait for all)
  const ip = getLocalIp()
  const port = process.env.PORT || 3000
  // Use provided publicUrl (ngrok) or fallback to local IP
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
  
  // Update sent count
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
  // Transparent 1x1 GIF
  const img = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")
  res.writeHead(200, {
    "Content-Type": "image/gif",
    "Content-Length": img.length
  })
  res.end(img)
})

app.post("/api/public/client", (req, res) => {
  const { email, nombre, apellido, celular, zona, tipo, campaignId } = req.body
  if (!email || !nombre) {
    return res.status(400).json({ error: "missing_fields" })
  }

  const clients = readData(clientsFile)
  let client = clients.find(c => c.email === email)

  if (client) {
    // Update existing
    client.nombre = nombre
    client.apellido = apellido
    client.celular = celular
    client.zona = zona
    client.tipo = tipo
    client.updated_at = new Date().toISOString()
    // Track campaign source if new
    if (campaignId) {
       if (!client.campaigns) client.campaigns = []
       if (!client.campaigns.includes(campaignId)) client.campaigns.push(campaignId)
    }
  } else {
    // Create new
    client = {
      id: Date.now(),
      email,
      nombre,
      apellido,
      celular,
      zona,
      tipo,
      created_at: new Date().toISOString(),
      campaigns: campaignId ? [campaignId] : []
    }
    clients.push(client)
  }
  writeData(clientsFile, clients)
  res.json({ ok: true })
})

app.post("/api/portal/register", (req, res) => {
  const { email, nombre, apellido, celular, zona, tipo } = req.body
  if (!email || !nombre || !celular) {
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
  client.celular = celular
  client.zona = zona || client.zona || ""
  client.tipo = tipo || client.tipo || ""
  client.portalRequestedAt = client.portalRequestedAt || now
  client.portalApproved = typeof client.portalApproved === "boolean" ? client.portalApproved : false

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

app.post("/api/campaign/public", requireAdmin, (req, res) => {
  const { subject, pdfUrl, publicUrl } = req.body
  if (!subject || !pdfUrl) return res.status(400).json({ error: "missing_fields" })

  const campaignId = "qr-" + Date.now().toString()
  const campaign = {
    id: campaignId,
    date: new Date().toISOString(),
    subject,
    pdfUrl,
    total: 0, // No emails sent
    sent: 0,
    opens: {},
    clicks: {},
    type: "qr" // Mark as QR/Public campaign
  }
  
  const campaigns = readData(campaignsFile)
  campaigns.unshift(campaign)
  writeData(campaignsFile, campaigns)

  const ip = getLocalIp()
  const port = process.env.PORT || 3000
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
        // Redirect to download form without email (user must enter it)
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
    // Redirect to download form instead of direct PDF
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

app.get("/api/clients", requireAdmin, (req, res) => {
  const data = readData(clientsFile)
  res.json(data)
})

app.post("/api/clients", (req, res) => {
  // Allow public access for adding new clients (from checkout), restrict full update if needed
  // For simplicity now, we just merge or overwrite.
  // Ideally, split into POST (add) and PUT (update whole list).
  // Here we assume the client sends the FULL list (Admin) or we handle single upsert.
  // To keep it compatible with current frontend logic (sending full list), we require admin OR special handling.
  // But wait, frontend sends full list. Let's stick to Admin only for full list update.
  // The checkout process only *reads* clients to see if exists, then *adds* one.
  // We need a specific endpoint for "upsert client" from public checkout without auth.
  
  // If headers has auth, it's admin saving full list
  const header = req.headers.authorization || ""
  if (header.includes("Basic")) {
    const data = req.body
    if (!Array.isArray(data)) return res.status(400).json({ error: "array_required" })
    writeData(clientsFile, data)
    return res.json({ ok: true })
  }
  
  // If public, we expect a single client object to upsert
  const client = req.body
  if (!client || !client.celular) return res.status(400).json({ error: "invalid_client" })
  
  const list = readData(clientsFile)
  const ced = (client.cedula || "").trim()
  const cel = (client.celular || "").trim()
  
  let found = null
  for (const c of list) {
    if (ced && c.cedula === ced) { found = c; break }
    if (!found && cel && c.celular === cel) found = c
  }
  
  if (!found) {
    const newId = list.length ? Math.max(...list.map(x => x.id || 0)) + 1 : 1
    found = { id: newId }
    list.push(found)
  }
  
  // Merge fields
  if (client.nombre) found.nombre = client.nombre
  if (client.apellido) found.apellido = client.apellido
  if (client.cedula) found.cedula = client.cedula
  if (client.email) found.email = client.email
  if (client.direccion) found.direccion = client.direccion
  if (client.celular) found.celular = client.celular
  if (client.tipo) found.tipo = client.tipo || found.tipo
  if (client.interesado) found.interesado = true
  if (client.pedidos) {
    const prev = typeof found.pedidos === "number" ? found.pedidos : 0
    found.pedidos = prev + 1
    found.interesado = true
  }
  
  writeData(clientsFile, list)
  res.json({ ok: true, id: found.id })
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
    const hay = `${p.name || ""} ${p.desc || ""}`.toLowerCase()
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
    const hay = `${p.name || ""} ${p.desc || ""} ${p.category || ""} ${p.subcategory || ""} ${p.material || ""} ${p.brand || ""}`.toLowerCase()
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
              priceText = ` - Precio aprox: $${Number(r.price).toLocaleString("es-AR")}`
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
      priceText = ` - Precio aprox: $${Number(p.price).toLocaleString("es-AR")}`
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

import os from "os"

// Webhook de Telegram deshabilitado temporalmente

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

const port = process.env.PORT || 3000
app.listen(port, "0.0.0.0", () => {
  const ip = getLocalIp()
  console.log(`Server on http://localhost:${port}`)
  console.log(`Network access: http://${ip}:${port}`)
})
