import {
  ENABLE_EMAIL_NOTIFICATIONS,
  NOTIFY_SENDER,
  NOTIFY_SMTP_HOST,
  NOTIFY_SMTP_PASSWORD,
  NOTIFY_SMTP_PORT,
  NOTIFY_SMTP_USER,
} from '@shm/shared'
import dotenv from 'dotenv'
import nodemailer from 'nodemailer'

console.log('What the what?!')

dotenv.config()

const transporter = ENABLE_EMAIL_NOTIFICATIONS
  ? nodemailer.createTransport({
      // @ts-expect-error not sure whats wrong here.. something wrong with the types
      host: NOTIFY_SMTP_HOST,
      port: NOTIFY_SMTP_PORT,
      secure: true,
      auth: {
        user: NOTIFY_SMTP_USER,
        pass: NOTIFY_SMTP_PASSWORD,
      },
    })
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

  console.log('Message sent: %s', info.messageId)

  return info
}
