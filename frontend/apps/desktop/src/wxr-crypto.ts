/**
 * Encryption utilities for WordPress import files.
 * Uses AES-256-GCM for encrypting import data with author keys.
 */
import * as crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const SALT_LENGTH = 32
const KEY_ITERATIONS = 100000

/**
 * Derive an encryption key from a password using PBKDF2.
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, KEY_ITERATIONS, 32, 'sha256')
}

/**
 * Encrypt data using AES-256-GCM.
 */
export function encrypt(data: string, password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH)
  const key = deriveKey(password, salt)
  const iv = crypto.randomBytes(IV_LENGTH)

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Format: salt (32) + iv (12) + authTag (16) + encrypted data
  const result = Buffer.concat([salt, iv, authTag, encrypted])
  return result.toString('base64')
}

/**
 * Decrypt data using AES-256-GCM.
 */
export function decrypt(encryptedData: string, password: string): string {
  const data = Buffer.from(encryptedData, 'base64')

  const salt = data.subarray(0, SALT_LENGTH)
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
  const authTag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH)

  const key = deriveKey(password, salt)

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return decrypted.toString('utf8')
}

/**
 * Import file format version 1.
 */
export interface SeedImportFileV1 {
  format: 'seed-import-v1'
  encrypted: boolean
  data: SeedImportData | string // plain object or encrypted ciphertext
}

/**
 * The actual import data structure.
 */
export interface SeedImportData {
  // Source information.
  source: {
    type: 'wordpress-wxr'
    siteTitle: string
    siteUrl: string
    exportDate: string
  }

  // Author mappings (login -> generated key info).
  authors: {
    [login: string]: {
      displayName: string
      email: string
      // Mnemonic words for key recovery (only in encrypted mode).
      mnemonic?: string[]
      // Public key after registration.
      publicKey?: string
    }
  }

  // Image URL to CID cache.
  imageCache: {
    [url: string]: string // url -> CID
  }

  // Import progress tracking.
  progress: {
    totalPosts: number
    importedPosts: number
    lastImportedId?: number
    phase: 'pending' | 'authors' | 'posts' | 'complete' | 'error'
    error?: string
  }

  // Posts to import (with their paths).
  posts: Array<{
    id: number
    path: string[]
    authorLogin: string
    imported: boolean
  }>

  // WXR post data needed for actual import (keyed by post ID).
  wxrPosts: {
    [id: number]: {
      id: number
      title: string
      slug: string
      content: string
      postDateGmt?: string
      categories: string[]
      tags: string[]
    }
  }
}

/**
 * Create a new import file structure.
 */
export function createImportFile(data: SeedImportData, password?: string): SeedImportFileV1 {
  if (password) {
    return {
      format: 'seed-import-v1',
      encrypted: true,
      data: encrypt(JSON.stringify(data), password),
    }
  }
  return {
    format: 'seed-import-v1',
    encrypted: false,
    data,
  }
}

/**
 * Parse an import file.
 */
export function parseImportFile(content: string, password?: string): SeedImportData {
  const file = JSON.parse(content) as SeedImportFileV1

  if (file.format !== 'seed-import-v1') {
    throw new Error(`Unsupported import file format: ${file.format}`)
  }

  if (file.encrypted) {
    if (!password) {
      throw new Error('Password required for encrypted import file')
    }
    const decrypted = decrypt(file.data as string, password)
    return JSON.parse(decrypted)
  }

  return file.data as SeedImportData
}

/**
 * Serialize an import file to string.
 */
export function serializeImportFile(file: SeedImportFileV1): string {
  return JSON.stringify(file, null, 2)
}
