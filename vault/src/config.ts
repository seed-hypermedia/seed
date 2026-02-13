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

/** Creates flag definitions with default values parsed from the current env. */
export const flags = (env: NodeJS.ProcessEnv = process.env) => ({
	"server-hostname": {
		type: String,
		default: env.SEED_VAULT_HTTP_HOSTNAME || "0.0.0.0",
		description: "The hostname to bind the HTTP server to",
	},
	"server-port": {
		type: Number,
		default: Number(env.SEED_VAULT_HTTP_PORT) || 3000,
		description: "The port to bind the HTTP server to",
	},

	"rp-id": {
		type: String,
		default: env.SEED_VAULT_RP_ID || "",
		description: "The relying party ID",
	},
	"rp-name": {
		type: String,
		default: env.SEED_VAULT_RP_NAME || "Seed Hypermedia Identity Vault",
		description: "The relying party name",
	},
	"rp-origin": {
		type: String,
		default: env.SEED_VAULT_RP_ORIGIN || "",
		description: "The relying party origin",
	},

	"db-path": {
		type: String,
		default: env.SEED_VAULT_DB_PATH || "vault.sqlite",
		description: "Path to the database file",
	},

	"smtp-host": {
		type: String,
		default: env.SEED_VAULT_SMTP_HOST || "",
		description: "The SMTP host to use for sending emails",
	},
	"smtp-port": {
		type: Number,
		default: Number(env.SEED_VAULT_SMTP_PORT) || 587,
		description: "The SMTP port to use for sending emails",
	},
	"smtp-user": {
		type: String,
		default: env.SEED_VAULT_SMTP_USER || "",
		description: "The SMTP username to use for sending emails",
	},
	"smtp-password": {
		type: String,
		default: env.SEED_VAULT_SMTP_PASSWORD || "",
		description: "The SMTP password to use for sending emails",
	},
	"smtp-sender": {
		type: String,
		default: env.SEED_VAULT_SMTP_SENDER || "",
		description: "The email address to use as the sender",
	},
})

type FlagsDef = ReturnType<typeof flags>

type ParsedFlags = cleye.TypeFlag<FlagsDef>["flags"]

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

	const dbPath = pflags["db-path"]

	const smtp = pflags["smtp-host"]
		? {
				host: pflags["smtp-host"],
				port: pflags["smtp-port"],
				user: pflags["smtp-user"],
				password: pflags["smtp-password"],
				sender: pflags["smtp-sender"],
			}
		: null

	return {
		http,
		relyingParty,
		dbPath,
		smtp,
	}
}
