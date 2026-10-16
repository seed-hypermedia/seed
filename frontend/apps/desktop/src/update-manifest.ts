import {createHash, createPublicKey, verify} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {z} from 'zod'
import {chromiumPolicySchema} from './app-chromium-age'

import {canonicalManifest, UPDATE_SIGNATURE_REQUIRED} from './update-signing'
export {canonicalManifest, DEV_UPDATE_PUBLIC_KEY, PROD_UPDATE_PUBLIC_KEY} from './update-signing'

const sha256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/)
const assetSchema = z
  .object({
    download_url: z.string().url(),
    zip_url: z.string().url().optional(),
    sha256: sha256Schema.optional(),
    zip_sha256: sha256Schema.optional(),
  })
  .passthrough()

// Older generators leave an empty object for a platform whose artifact was not built.
const optionalAssetSchema = z
  .union([
    assetSchema,
    z
      .object({})
      .strict()
      .transform(() => undefined),
  ])
  .optional()

/** Validates the existing manifest plus optional integrity and browser-policy fields. */
export const updateManifestSchema = chromiumPolicySchema
  .extend({
    name: z.string().min(1),
    tag_name: z.string(),
    release_notes: z.string(),
    signature: z
      .string()
      .regex(/^[A-Za-z0-9+/]{86}==$/)
      .optional(),
    assets: z
      .object({
        macos: z.object({x64: optionalAssetSchema, arm64: optionalAssetSchema}).passthrough().optional(),
        win32: z.object({x64: optionalAssetSchema}).passthrough().optional(),
        linux: z.object({deb: optionalAssetSchema, rpm: optionalAssetSchema}).passthrough().optional(),
      })
      .passthrough(),
  })
  .passthrough()

/** Verifies raw JSON before parsing or acting on it, including otherwise unknown signed fields. */
export function verifyUpdateManifest(
  raw: unknown,
  publicKey: string,
  warn: (message: string) => void,
  required: boolean = UPDATE_SIGNATURE_REQUIRED,
) {
  const manifest = updateManifestSchema.parse(raw)
  if (!manifest.signature) {
    if (required) throw new Error('Update manifest signature is required')
    warn('[AUTO-UPDATE] Unsigned update manifest accepted during signature rollout')
    return manifest
  }
  if (!publicKey) {
    if (required) throw new Error('Update signing public key is not configured')
    warn('[AUTO-UPDATE] Update signature verification skipped: public key is not configured')
    return manifest
  }
  const key = createPublicKey(publicKey)
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    !verify(
      null,
      Buffer.from(canonicalManifest(raw as Record<string, unknown>)),
      key,
      Buffer.from(manifest.signature, 'base64'),
    )
  )
    throw new Error('Invalid update manifest signature')
  for (const asset of [
    manifest.assets.macos?.x64,
    manifest.assets.macos?.arm64,
    manifest.assets.win32?.x64,
    manifest.assets.linux?.deb,
    manifest.assets.linux?.rpm,
  ]) {
    if (asset) {
      if (!asset.sha256 || (asset.zip_url && !asset.zip_sha256)) {
        throw new Error('Signed update asset is missing its SHA-256 digest')
      }
    }
  }
  return manifest
}

/** Streams the downloaded installer from disk and refuses installation on digest mismatch. */
export async function verifyUpdateAsset(filePath: string, expectedSha256?: string): Promise<void> {
  if (expectedSha256 === undefined) return
  sha256Schema.parse(expectedSha256)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  if (hash.digest('hex') !== expectedSha256.toLowerCase()) throw new Error('Update asset SHA-256 mismatch')
}
