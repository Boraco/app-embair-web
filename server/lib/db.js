import Database from "better-sqlite3"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let db

export function initDb() {
  const dataDir = path.join(__dirname, "..", "..", "data")
  const dbPath = path.join(dataDir, "app.db")
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
  db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      service TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      datetime TEXT NOT NULL,
      status TEXT NOT NULL,
      FOREIGN KEY(client_id) REFERENCES clients(id)
    );
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      guide INTEGER NOT NULL DEFAULT 0,
      rates INTEGER NOT NULL DEFAULT 0,
      portfolio INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(client_id) REFERENCES clients(id)
    );
    CREATE INDEX IF NOT EXISTS idx_appointments_datetime ON appointments(datetime);
  `)
}

export function getDb() {
  return db
}

export function isSlotTaken(iso) {
  const row = db.prepare("SELECT id FROM appointments WHERE datetime = ? AND status != 'rejected'").get(iso)
  return !!row
}

export function insertLead({ name, email, phone, service, datetime, materials }) {
  const now = new Date().toISOString()
  const clientStmt = db.prepare("INSERT INTO clients (name, email, phone, service, created_at) VALUES (?, ?, ?, ?, ?)")
  const clientId = clientStmt.run(name, email, phone, service, now).lastInsertRowid
  const apptStmt = db.prepare("INSERT INTO appointments (client_id, datetime, status) VALUES (?, ?, ?)")
  const appointmentId = apptStmt.run(clientId, datetime, "pending").lastInsertRowid
  const mat = { guide: 0, rates: 0, portfolio: 0 }
  for (const m of materials) {
    if (m === "Guía") mat.guide = 1
    if (m === "Tarifas") mat.rates = 1
    if (m === "Portafolio") mat.portfolio = 1
  }
  const matStmt = db.prepare("INSERT INTO materials (client_id, guide, rates, portfolio) VALUES (?, ?, ?, ?)")
  matStmt.run(clientId, mat.guide, mat.rates, mat.portfolio)
  return { clientId, appointmentId }
}

export function getAvailability(date) {
  const open = 9
  const close = 18
  const step = 30
  const slots = []
  for (let h = open; h < close; h++) {
    for (let m = 0; m < 60; m += step) {
      const hh = String(h).padStart(2, "0")
      const mm = String(m).padStart(2, "0")
      const time = `${hh}:${mm}`
      const iso = new Date(`${date}T${time}:00`).toISOString()
      const taken = isSlotTaken(iso)
      slots.push({ time, available: !taken })
    }
  }
  return slots
}

export function listRequests() {
  const rows = db.prepare(`
    SELECT a.id as appointment_id, c.id as client_id, c.name, c.email, c.phone, c.service, a.datetime, a.status,
           m.guide, m.rates, m.portfolio
    FROM appointments a
    JOIN clients c ON a.client_id = c.id
    LEFT JOIN materials m ON m.client_id = c.id
    ORDER BY a.datetime DESC
  `).all()
  return rows
}

export function updateAppointmentStatus(id, status) {
  db.prepare("UPDATE appointments SET status = ? WHERE id = ?").run(status, id)
}

export function generateClientsCsv() {
  const rows = db.prepare(`
    SELECT c.name, c.email, c.phone, c.service, a.datetime, a.status, m.guide, m.rates, m.portfolio
    FROM appointments a
    JOIN clients c ON a.client_id = c.id
    LEFT JOIN materials m ON m.client_id = c.id
    ORDER BY a.datetime DESC
  `).all()
  const header = ["Nombre", "Email", "Teléfono", "Servicio", "FechaHoraISO", "Estado", "Guía", "Tarifas", "Portafolio"]
  const lines = [header.join(",")]
  for (const r of rows) {
    const line = [
      escapeCsv(r.name),
      escapeCsv(r.email),
      escapeCsv(r.phone),
      escapeCsv(r.service),
      escapeCsv(r.datetime),
      escapeCsv(r.status),
      r.guide ? "1" : "0",
      r.rates ? "1" : "0",
      r.portfolio ? "1" : "0"
    ].join(",")
    lines.push(line)
  }
  return lines.join("\n")
}

function escapeCsv(v) {
  const s = String(v ?? "")
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}
