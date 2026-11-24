/**
 * Host config (hypermedia/build/signed-api-apps.md, "Host config"): every host (an app or an agent) has a
 * public config in its document (`publicConfig`, described by `publicConfigSchema`) and a private
 * config held here, encrypted like other secrets (`privateConfigSchema` describes it). Only the
 * host's own tools and sessions use the private values; callers see which fields are set, never
 * what they hold.
 *
 * This module is the store. Who may read or change a host's config is decided by the callers
 * (app-running.ts), which check the host and the signer first.
 */

import type {Database} from 'bun:sqlite'

/** Encrypts and decrypts private config with the server's secret key. */
export type HostConfigCrypto = {
  encrypt: (plain: Uint8Array) => Uint8Array
  decrypt: (ciphertext: Uint8Array) => Uint8Array
}

type HostConfigRow = {
  host_id: string
  space_uid: string
  private_config_ciphertext: Uint8Array | null
  updated_by: string
  created_at: number
  updated_at: number
}

/** What is known about a host's private config without its values. */
export type HostConfigState = {
  /** Names of the private config fields that are set. */
  privateConfigKeys: string[]
  /** Who last changed the private config, and when; absent when it was never set. */
  updatedBy?: string
  updatedAt?: number
}

function getRow(db: Database, hostId: string): HostConfigRow | null {
  return (db.query('SELECT * FROM host_config WHERE host_id = ?').get(hostId) as HostConfigRow | null) ?? null
}

function decode(row: HostConfigRow | null, crypto: HostConfigCrypto): Record<string, unknown> {
  if (!row?.private_config_ciphertext) return {}
  const parsed = JSON.parse(new TextDecoder().decode(crypto.decrypt(new Uint8Array(row.private_config_ciphertext))))
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
}

/** A host's private config values (empty when none are set). Only for running the host's own code. */
export function readPrivateConfig(db: Database, crypto: HostConfigCrypto, hostId: string): Record<string, unknown> {
  return decode(getRow(db, hostId), crypto)
}

/** The names of a host's private config fields and who last set them; never the values. */
export function hostConfigState(db: Database, crypto: HostConfigCrypto, hostId: string): HostConfigState {
  const row = getRow(db, hostId)
  if (!row) return {privateConfigKeys: []}
  return {
    privateConfigKeys: Object.keys(decode(row, crypto)).sort(),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}

/**
 * The private config after applying `changes` to what is stored: a value replaces that field, a
 * null removes it, and fields not named keep their values (so one secret can change without
 * sending the others again).
 */
export function mergePrivateConfig(
  stored: Record<string, unknown>,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {...stored}
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete merged[key]
    else if (value !== undefined) merged[key] = value
  }
  return merged
}

/** Stores a host's whole private config (already merged and checked). An empty config clears it. */
export function writePrivateConfig(
  db: Database,
  crypto: HostConfigCrypto,
  host: {hostId: string; spaceUid: string},
  privateConfig: Record<string, unknown>,
  updatedBy: string,
): void {
  const ciphertext = Object.keys(privateConfig).length
    ? crypto.encrypt(new TextEncoder().encode(JSON.stringify(privateConfig)))
    : null
  const now = Date.now()
  db.query(
    `INSERT INTO host_config (host_id, space_uid, private_config_ciphertext, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (host_id) DO UPDATE SET private_config_ciphertext = excluded.private_config_ciphertext,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).run(host.hostId, host.spaceUid, ciphertext, updatedBy, now, now)
}

/** Forgets a host's private config. */
export function deletePrivateConfig(db: Database, hostId: string): void {
  db.query('DELETE FROM host_config WHERE host_id = ?').run(hostId)
}
