import * as emailTemplate from '@/email-template'
import nodemailer from 'nodemailer'

/** SMTP connection configuration. */
export type SmtpConfig = {
  host: string
  port: number
  user: string
  password: string
  sender: string
}

/**
 * The hosting service's HTTPS email relay, for instances without an SMTP
 * account of their own. The relay sets the From address itself.
 */
export type RelayConfig = {
  url: string
  token: string
}

/** The body of one `POST <relay url>`. */
export type RelayMessage = {
  to: string
  subject: string
  text: string
  html?: string
  replyTo?: string
}

/** What an invitation email says besides the link. */
export type InvitationEmailOptions = {
  /** The organization's site name (the relying party name). */
  siteName: string
  role: 'reader' | 'writer'
}

/** Sends login/verification and invitation emails. */
export interface EmailSender {
  sendVerificationEmail(to: string, code: string): Promise<void>
  sendInvitationEmail(to: string, link: string, opts: InvitationEmailOptions): Promise<void>
}

/** Sends emails via SMTP using nodemailer. */
class SmtpSender implements EmailSender {
  private transporter: nodemailer.Transporter
  private sender: string
  private logoUrl: string

  constructor(config: SmtpConfig, webBaseUrl: string) {
    this.sender = config.sender
    this.logoUrl = logoUrlFor(webBaseUrl)
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      // Use STARTTLS (port 587) — Bun's TLS doesn't support implicit TLS (port 465).
      // Connection is still fully encrypted after the STARTTLS upgrade.
      secure: false,
      auth: {
        user: config.user,
        pass: config.password,
      },
    } as nodemailer.TransportOptions)
  }

  async sendVerificationEmail(to: string, code: string): Promise<void> {
    console.log(`Sending email to ${to}...`)
    const {subject, text, html} = emailTemplate.createVerificationEmail(code, this.logoUrl)
    await this.transporter.sendMail({
      from: this.sender,
      to,
      subject,
      text,
      html,
    })
    console.log(`Email sent to ${to}`)
  }

  async sendInvitationEmail(to: string, link: string, opts: InvitationEmailOptions): Promise<void> {
    console.log(`Sending invitation to ${to}...`)
    const {subject, text, html} = emailTemplate.createInvitationEmail(link, opts, this.logoUrl)
    await this.transporter.sendMail({from: this.sender, to, subject, text, html})
    console.log(`Invitation sent to ${to}`)
  }
}

/**
 * Sends emails through the hosting service's relay: one JSON POST per
 * message, authorized by a bearer token. Anything but a 2xx is an error, the
 * way an SMTP rejection is; the token is never part of the message.
 */
export class RelaySender implements EmailSender {
  private config: RelayConfig
  private logoUrl: string
  private fetchImpl: typeof fetch

  constructor(config: RelayConfig, webBaseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.config = config
    this.logoUrl = logoUrlFor(webBaseUrl)
    this.fetchImpl = fetchImpl
  }

  async sendVerificationEmail(to: string, code: string): Promise<void> {
    console.log(`Sending email to ${to} via relay...`)
    const {subject, text, html} = emailTemplate.createVerificationEmail(code, this.logoUrl)
    await this.send({to, subject, text, html})
    console.log(`Email sent to ${to}`)
  }

  async sendInvitationEmail(to: string, link: string, opts: InvitationEmailOptions): Promise<void> {
    console.log(`Sending invitation to ${to} via relay...`)
    const {subject, text, html} = emailTemplate.createInvitationEmail(link, opts, this.logoUrl)
    await this.send({to, subject, text, html})
    console.log(`Invitation sent to ${to}`)
  }

  async send(message: RelayMessage): Promise<void> {
    let response: Response
    try {
      response = await this.fetchImpl(this.config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.token}`,
        },
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
  }
}

/** Dev fallback that logs verification codes to the console. */
class ConsoleSender implements EmailSender {
  async sendVerificationEmail(to: string, code: string): Promise<void> {
    console.log(`\n📧 Verification code for ${to}: ${code}\n`)
  }

  async sendInvitationEmail(to: string, link: string, opts: InvitationEmailOptions): Promise<void> {
    console.log(`\n📧 Invitation for ${to} (${opts.role}): ${link}\n`)
  }
}

function logoUrlFor(webBaseUrl: string): string {
  return webBaseUrl ? new URL('/email-logo.png', webBaseUrl).toString() : ''
}

export type SenderOptions = {
  smtp: SmtpConfig | null
  /** Wins over SMTP when both are configured. */
  relay: RelayConfig | null
  webBaseUrl: string
}

/** Create an EmailSender: RelaySender if a relay is configured, SmtpSender if SMTP is, ConsoleSender otherwise. */
export function createSender(opts: SenderOptions): EmailSender {
  if (opts.relay) {
    console.log(`Email: relay configured (${opts.relay.url}), sending real emails`)
    return new RelaySender(opts.relay, opts.webBaseUrl)
  }
  if (opts.smtp) {
    console.log('Email: SMTP configured, sending real emails')
    return new SmtpSender(opts.smtp, opts.webBaseUrl)
  }
  console.warn('Email: No SMTP or relay configured, verification codes will be logged to console')
  return new ConsoleSender()
}
