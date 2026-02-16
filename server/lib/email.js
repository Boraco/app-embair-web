import nodemailer from "nodemailer"

export async function sendConfirmation({ to, name, datetime, service }) {
  const host = process.env.SMTP_HOST || ""
  const port = Number(process.env.SMTP_PORT || 0)
  const user = process.env.SMTP_USER || ""
  const pass = process.env.SMTP_PASS || ""
  if (!host || !port || !user || !pass) return
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  })
  const dt = new Date(datetime)
  const dateStr = dt.toLocaleString("es-ES")
  const subject = "Confirmación de solicitud"
  const text = `Hola ${name}, tu solicitud para ${service} ha sido recibida. Fecha y hora: ${dateStr}. Pronto confirmaremos tu cita.`
  await transporter.sendMail({
    from: user,
    to,
    subject,
    text
  })
}
