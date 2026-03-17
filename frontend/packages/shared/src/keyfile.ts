import * as base64 from './base64'
import * as encryption from './encryption'

/**
 * Profile metadata included in exported key files for human readability.
 */
export interface Profile {
  name?: string
  description?: string
}

/**
 * Argon2id parameters recorded in encrypted key files.
 */
export interface Argon2 {
  memoryCost: number
  timeCost: number
  parallelism: number
  saltB64: string
}

/**
 * Encryption metadata recorded in encrypted key files.
 */
export interface Encryption {
  kdf: 'argon2id'
  argon2: Argon2
  cipher: 'xchacha20poly1305'
}

/**
 * Exported payload written to `.hmkey.json` files.
 */
export interface Payload {
  createTime: string
  publicKey: string
  keyB64: string
  encryption?: Encryption
  profile?: Profile
}

/**
 * Creates a `.hmkey.json` payload from raw key bytes.
 */
export async function create(input: {
  publicKey: string
  key: Uint8Array
  password?: string
  profile?: Profile
  createTime?: string
}): Promise<Payload> {
  const createTime = input.createTime ?? new Date().toISOString()
  const includedProfile = input.profile && (input.profile.name || input.profile.description) ? input.profile : undefined

  if (!input.password) {
    return {
      createTime,
      publicKey: input.publicKey,
      keyB64: base64.encode(input.key),
      ...(includedProfile ? {profile: includedProfile} : {}),
    }
  }

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const derivedKey = await encryption.deriveKeyFromPassword(input.password, salt, encryption.DEFAULT_PARAMS)
  const encrypted = await encryption.encrypt(input.key, derivedKey)

  return {
    createTime,
    publicKey: input.publicKey,
    keyB64: base64.encode(encrypted),
    encryption: {
      kdf: 'argon2id',
      argon2: {
        memoryCost: encryption.DEFAULT_PARAMS.memoryCost,
        timeCost: encryption.DEFAULT_PARAMS.timeCost,
        parallelism: encryption.DEFAULT_PARAMS.parallelism,
        saltB64: base64.encode(salt),
      },
      cipher: 'xchacha20poly1305',
    },
    ...(includedProfile ? {profile: includedProfile} : {}),
  }
}

/**
 * Parses a serialized `.hmkey.json` payload.
 */
export function parse(json: string): Payload {
  const value = JSON.parse(json)

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid key file payload')
  }

  return value as Payload
}

/**
 * Serializes a `.hmkey.json` payload with a trailing newline.
 */
export function stringify(payload: Payload): string {
  return `${JSON.stringify(payload, null, 2)}\n`
}

/**
 * Decrypts or decodes the raw key bytes from a `.hmkey.json` payload.
 */
export async function decrypt(payload: Payload, password?: string): Promise<Uint8Array> {
  if (!payload.keyB64) {
    throw new Error('keyB64 is required')
  }

  if (!payload.encryption) {
    return base64.decode(payload.keyB64)
  }

  if (!password) {
    throw new Error('password is required for encrypted key files')
  }

  if (payload.encryption.kdf !== 'argon2id') {
    throw new Error(`unsupported key derivation function "${payload.encryption.kdf}"`)
  }
  if (payload.encryption.cipher !== 'xchacha20poly1305') {
    throw new Error(`unsupported cipher "${payload.encryption.cipher}"`)
  }
  if (!payload.encryption.argon2) {
    throw new Error('argon2 parameters are required')
  }
  if (
    !payload.encryption.argon2.memoryCost ||
    !payload.encryption.argon2.timeCost ||
    !payload.encryption.argon2.parallelism
  ) {
    throw new Error('argon2 parameters must be greater than zero')
  }
  if (!payload.encryption.argon2.saltB64) {
    throw new Error('saltB64 is required for encrypted key files')
  }

  const derivedKey = await encryption.deriveKeyFromPassword(
    password,
    base64.decode(payload.encryption.argon2.saltB64),
    {
      memoryCost: payload.encryption.argon2.memoryCost,
      timeCost: payload.encryption.argon2.timeCost,
      parallelism: payload.encryption.argon2.parallelism,
    },
  )

  return encryption.decrypt(base64.decode(payload.keyB64), derivedKey)
}
