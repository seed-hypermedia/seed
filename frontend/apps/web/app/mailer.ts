import {
  ENABLE_EMAIL_NOTIFICATIONS,
  NOTIFY_SENDER,
  NOTIFY_SMTP_HOST,
  NOTIFY_SMTP_PASSWORD,
  NOTIFY_SMTP_PORT,
  NOTIFY_SMTP_USER,
} from '@shm/shared/constants'
import nodemailer from 'nodemailer'

const transporter =
  ENABLE_EMAIL_NOTIFICATIONS &&
  NOTIFY_SMTP_HOST &&
  NOTIFY_SMTP_USER &&
  NOTIFY_SMTP_PASSWORD
    ? nodemailer.createTransport({
        host: NOTIFY_SMTP_HOST as string,
        port: NOTIFY_SMTP_PORT ? parseInt(NOTIFY_SMTP_PORT, 10) : 587,
        secure: true,
        auth: {
          user: NOTIFY_SMTP_USER as string,
          pass: NOTIFY_SMTP_PASSWORD as string,
        },
      } as nodemailer.TransportOptions)
    : null

export async function sendEmail(
  to: string,
  subject: string,
  body: {text: string; html?: string},
  senderLabel?: string,
) {
  if (!transporter) {
    console.error('Email notifier is not enabled')
    return
  }
  console.log(`Sending email to ${to} with subject ${subject}`)

  const from = senderLabel
    ? `${senderLabel} <${NOTIFY_SMTP_USER}>`
    : NOTIFY_SENDER

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text: body.text,
    html: body.html,
  })

  return info
}
