import nodemailer from "nodemailer"
import * as emailTemplate from "@/email-template"

/** SMTP connection configuration. */
export type SmtpConfig = {
	host: string
	port: number
	user: string
	password: string
	sender: string
}

/** Sends login/verification emails. */
export interface EmailSender {
	sendLoginLink(to: string, loginUrl: string): Promise<void>
}

/** Sends emails via SMTP using nodemailer. */
class SmtpSender implements EmailSender {
	private transporter: nodemailer.Transporter
	private sender: string

	constructor(config: SmtpConfig) {
		this.sender = config.sender
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

	async sendLoginLink(to: string, loginUrl: string): Promise<void> {
		console.log(`Sending email to ${to}...`)
		const { subject, text, html } = emailTemplate.createLoginEmail(loginUrl)
		await this.transporter.sendMail({
			from: this.sender,
			to,
			subject,
			text,
			html,
		})
		console.log(`Email sent to ${to}`)
	}
}

/** Dev fallback that logs magic links to the console. */
class ConsoleSender implements EmailSender {
	async sendLoginLink(to: string, loginUrl: string): Promise<void> {
		console.log(`\n📧 Magic link for ${to}:\n${loginUrl}\n`)
	}
}

/** Create an EmailSender: SmtpSender if SMTP is configured, ConsoleSender otherwise. */
export function createSender(smtp: SmtpConfig | null): EmailSender {
	if (smtp) {
		console.log("Email: SMTP configured, sending real emails")
		return new SmtpSender(smtp)
	}
	console.warn("Email: No SMTP configured, magic links will be logged to console")
	return new ConsoleSender()
}
