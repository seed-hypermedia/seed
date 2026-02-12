import type * as cleye from "cleye"
import type * as email from "@/email"

export type RelyingParty = {
	id: string
	name: string
	origin: string
}

export type Server = {
	port: number
	hostname: string
}

export type Config = {
	http: Server
	relyingParty: RelyingParty
	dbPath: string
	smtp: email.SmtpConfig | null
}

export const flags = {
	"server-hostname": {
		type: String,
		default: process.env.SEED_VAULT_HTTP_HOSTNAME || "0.0.0.0",
		description: "The hostname to bind the HTTP server to",
	},
	"server-port": {
		type: Number,
		default: Number(process.env.SEED_VAULT_HTTP_PORT) || 3000,
		description: "The port to bind the HTTP server to",
	},
	"rp-id": {
		type: String,
		default: process.env.SEED_VAULT_RP_ID || "",
		description: "The relying party ID",
	},
	"rp-name": {
		type: String,
		default: process.env.SEED_VAULT_RP_NAME || "Seed Hypermedia Identity Vault",
		description: "The relying party name",
	},
	"rp-origin": {
		type: String,
		default: process.env.SEED_VAULT_RP_ORIGIN || "",
		description: "The relying party origin",
	},
	"db-path": {
		type: String,
		default: process.env.SEED_VAULT_DB_PATH || "vault.sqlite",
		description: "Path to the database file",
	},
}

type ParsedFlags = cleye.TypeFlag<typeof flags>["flags"]

export function create(pflags: ParsedFlags): Config {
	const http: Server = {
		hostname: pflags["server-hostname"],
		port: pflags["server-port"],
	}

	const relyingParty: RelyingParty = {
		id: pflags["rp-id"],
		name: pflags["rp-name"],
		origin: pflags["rp-origin"],
	}

	if (!relyingParty.id) {
		throw new Error("Relying party ID configuration is required")
	}

	if (!relyingParty.origin) {
		throw new Error("Relying party origin configuration is required")
	}

	const smtpHost = process.env.SEED_VAULT_SMTP_HOST
	const smtp: email.SmtpConfig | null = smtpHost
		? {
				host: smtpHost,
				port: Number(process.env.SEED_VAULT_SMTP_PORT) || 587,
				user: process.env.SEED_VAULT_SMTP_USER || "",
				password: process.env.SEED_VAULT_SMTP_PASSWORD || "",
				sender: process.env.SEED_VAULT_SMTP_SENDER || "",
			}
		: null

	return {
		http,
		relyingParty,
		dbPath: pflags["db-path"],
		smtp,
	}
}
