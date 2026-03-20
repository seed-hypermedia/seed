import {
  NOTIFY_SENDER,
  NOTIFY_SMTP_HOST,
  NOTIFY_SMTP_PASSWORD,
  NOTIFY_SMTP_PORT,
  NOTIFY_SMTP_USER,
} from '@shm/shared/constants'
import nodemailer from 'nodemailer'

const transporter =
  NOTIFY_SMTP_HOST && NOTIFY_SMTP_USER && NOTIFY_SMTP_PASSWORD
    ? nodemailer.createTransport({
        host: NOTIFY_SMTP_HOST as string,
        port: NOTIFY_SMTP_PORT ? parseInt(NOTIFY_SMTP_PORT, 10) : 587,
        secure: true,
        pool: true,
        maxConnections: 5,
        rateLimit: 10,
        auth: {
          user: NOTIFY_SMTP_USER as string,
          pass: NOTIFY_SMTP_PASSWORD as string,
        },
      } as nodemailer.TransportOptions)
    : null

/** Optional extra headers for deliverability. */
export type EmailHeaders = {
  /** RFC 8058 one-click unsubscribe URL (e.g. `<https://example.com/unsub?token=X>`) */
  unsubscribeUrl?: string
  /** Notification reason used for Feedback-Id (Google Postmaster Tools). */
  feedbackId?: string
}

/** Send an email via the configured SMTP transporter. */
export async function sendEmail(
  to: string,
  subject: string,
  body: {text: string; html?: string},
  senderLabel?: string,
  headers?: EmailHeaders,
) {
  if (!transporter) {
    console.error(`Email notifier is not enabled. Failed to send email to ${to} with subject ${subject}`)
    return
  }
  console.log(`Sending email to ${to} with subject ${subject}`)

  const from = senderLabel ? `${senderLabel} <${NOTIFY_SMTP_USER}>` : NOTIFY_SENDER

  const extraHeaders: Record<string, string> = {
    Precedence: 'bulk',
    'X-Auto-Response-Suppress': 'OOF, AutoReply',
  }

  if (headers?.unsubscribeUrl) {
    extraHeaders['List-Unsubscribe'] = `<${headers.unsubscribeUrl}>`
    extraHeaders['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
  }

  if (headers?.feedbackId) {
    extraHeaders['Feedback-Id'] = `${headers.feedbackId}:seed-notify`
  }

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text: body.text,
    html: body.html,
    headers: extraHeaders,
  })

  return info
}
