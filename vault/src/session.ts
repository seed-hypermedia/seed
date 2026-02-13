import type * as sqlite from "bun:sqlite"
import { Cookie } from "bun"
import { nanoid } from "nanoid"

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000 // 24 hours.

const isProd = process.env.NODE_ENV === "production"

/**
 * The name of the cookie used to store the session ID.
 */
export const SESSION_COOKIE_NAME = isProd ? "__Host-Vault-Session" : "Vault-Session"

export type Session = {
	id: string
	user_id: string
	expire_time: number
	create_time: number
}

export class Store {
	constructor(private database: sqlite.Database) {}

	/**
	 * Create a new session for a user.
	 */
	createSession(userId: string): Session {
		const now = Date.now()
		const session: Session = {
			id: randomId(),
			user_id: userId,
			expire_time: now + SESSION_DURATION_MS,
			create_time: now,
		}

		this.database.run(`INSERT INTO sessions (id, user_id, expire_time, create_time) VALUES (?, ?, ?, ?)`, [
			session.id,
			session.user_id,
			session.expire_time,
			session.create_time,
		])

		return session
	}

	/**
	 * Get a session by ID if it's still valid.
	 */
	getSession(sessionId: string): Session | null {
		const row = this.database
			.query<Session, [string, number]>(`SELECT * FROM sessions WHERE id = ? AND expire_time > ?`)
			.get(sessionId, Date.now())
		return row ?? null
	}

	/**
	 * Delete a session (logout).
	 */
	deleteSession(sessionId: string): void {
		this.database.run(`DELETE FROM sessions WHERE id = ?`, [sessionId])
	}
}

/**
 * Create a Set-Cookie header for a session.
 */
export function createCookie(session: Session): string {
	const cookie = new Cookie({
		name: SESSION_COOKIE_NAME,
		value: session.id,
		httpOnly: true,
		sameSite: "strict",
		maxAge: Math.floor(SESSION_DURATION_MS / 1000),
		path: "/",
		secure: isProd,
	})
	return cookie.toString()
}

/**
 * Create a cookie to clear the session.
 */
export function clearCookie(): string {
	const cookie = new Cookie({
		name: SESSION_COOKIE_NAME,
		value: "",
		httpOnly: true,
		sameSite: "strict",
		maxAge: 0,
		path: "/",
		secure: isProd,
	})
	return cookie.toString()
}

// Helper to generate IDs.
export function randomId(): string {
	return nanoid(21)
}
