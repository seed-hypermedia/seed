import {
  NOTIFY_EMAIL_RELAY_TOKEN,
  NOTIFY_EMAIL_RELAY_URL,
  NOTIFY_SENDER,
  NOTIFY_SMTP_HOST,
  NOTIFY_SMTP_PASSWORD,
  NOTIFY_SMTP_PORT,
  NOTIFY_SMTP_USER,
} from '@shm/shared/constants'
import nodemailer from 'nodemailer'

/**
 * The hosting service's HTTPS email relay, for instances without an SMTP
 * account of their own (the enterprise profile). One JSON POST per message
 * with a bearer token; the relay sets the From address itself. When
 * configured it wins over SMTP.
 */
const relay =
  NOTIFY_EMAIL_RELAY_URL && NOTIFY_EMAIL_RELAY_TOKEN
    ? {url: NOTIFY_EMAIL_RELAY_URL, token: NOTIFY_EMAIL_RELAY_TOKEN}
    : null

const SMTP_PORT = NOTIFY_SMTP_PORT ? parseInt(NOTIFY_SMTP_PORT, 10) : 587

const transporter =
  !relay && NOTIFY_SMTP_HOST && NOTIFY_SMTP_USER && NOTIFY_SMTP_PASSWORD
    ? nodemailer.createTransport({
        host: NOTIFY_SMTP_HOST as string,
        port: SMTP_PORT,
        // STARTTLS on 587 (the default). Under Bun, implicit TLS on 465 is unreliable: from the dev
        // host most connections to Mailgun never got the greeting (ETIMEDOUT), with or without SNI,
        // while STARTTLS connected every time. The vault's mailer uses STARTTLS for the same reason.
        secure: SMTP_PORT === 465,
        tls: {servername: NOTIFY_SMTP_HOST as string},
        pool: true,
        maxConnections: 5,
        rateLimit: 10,
        auth: {
          user: NOTIFY_SMTP_USER as string,
          pass: NOTIFY_SMTP_PASSWORD as string,
        },
      })
    : null

/** Optional extra headers for deliverability. */
export type EmailHeaders = {
  /** RFC 8058 one-click unsubscribe URL (e.g. `<https://example.com/unsub?token=X>`) */
  unsubscribeUrl?: string
  /** Notification reason used for Feedback-Id (Google Postmaster Tools). */
  feedbackId?: string
}

/** The body of one `POST <relay url>`. */
export type RelayMessage = {
  to: string
  subject: string
  text: string
  html?: string
  replyTo?: string
}

/** Send one message through the relay; anything but a 2xx is an error, like an SMTP rejection. */
async function sendViaRelay(message: RelayMessage): Promise<{messageId?: string}> {
  if (!relay) throw new Error('Email relay is not configured')
  let response: Response
  try {
    response = await fetch(relay.url, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${relay.token}`},
      body: JSON.stringify(message),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Email relay unreachable: ${reason}`)
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200)
    throw new Error(`Email relay refused the message: HTTP ${response.status}${detail ? ` ${detail}` : ''}`)
  }
  return {}
}

/** Send an email via the configured relay or SMTP transporter. */
export async function sendEmail(
  to: string,
  subject: string,
  body: {text: string; html?: string},
  senderLabel?: string,
  headers?: EmailHeaders,
) {
  if (relay) {
    console.log(`Sending email to ${to} with subject ${subject} via relay`)
    const message: RelayMessage = {to, subject, text: body.text}
    if (body.html) message.html = body.html
    return sendViaRelay(message)
  }

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
