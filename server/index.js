import express from "express"
import dotenv from "dotenv"
import rateLimit from "express-rate-limit"
import path from "path"
import { fileURLToPath } from "url"
import fs from "fs"
import multer from "multer"
import nodemailer from "nodemailer"
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
  res.setHeader("WWW-Authenticate", 'Basic realm="Admin"')
  return res.status(401).send("Unauthorized")
}

app.use(express.static(path.join(__dirname, "..", "public")))

app.get("/", (req, res) => {
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
