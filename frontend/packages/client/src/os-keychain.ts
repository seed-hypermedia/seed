/**
 * Read-only access to the OS keychain / Secret Service.
 *
 * Node/Bun only — shells out to the platform's native secret tool, the same
 * stores the Go daemon writes to via zalando/go-keyring:
 *
 * Linux: `secret-tool` (libsecret / D-Bus Secret Service).
 * macOS: `security` (Keychain).
 *
 * Do not import this module from browser code; use it via a Node-only entry
 * point such as `vault-local.ts`.
 */

import {execSync} from 'node:child_process'
import {platform} from 'node:os'

const GO_KEYRING_PREFIX = 'go-keyring-base64:'

/**
 * Reads a raw secret value from the OS keychain.
 * Returns null when no matching item exists.
 */
export function readOSSecret(service: string, account: string): string | null {
  const os = platform()

  try {
    if (os === 'linux') {
      const result = execSync(`secret-tool lookup service ${esc(service)} username ${esc(account)}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return result.trim()
    }

    if (os === 'darwin') {
      const result = execSync(`security find-generic-password -s ${esc(service)} -a ${esc(account)} -w`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return result.trim()
    }

    throw new Error(`Unsupported platform: ${os}. Only linux and darwin are supported.`)
  } catch (err: unknown) {
    // secret-tool exits 1 when no item matches; macOS `security` exits 44.
    // The exit code lives on the error object — it never appears in the message.
    const status = (err as {status?: number | null})?.status
    if (status === 1 || status === 44) {
      return null
    }
    const msg = err instanceof Error ? err.message : String(err)
    if (
      msg.includes('not found') ||
      msg.includes('No matching') ||
      msg.includes('could not be found') ||
      msg.includes('SecKeychainSearchCopyNext') ||
      msg.includes('The specified item could not be found')
    ) {
      return null
    }
    throw err
  }
}

/**
 * Strips the `go-keyring-base64:` wrapping that zalando/go-keyring applies to
 * some stored values, returning the decoded plain string.
 */
export function stripGoKeyringPrefix(raw: string): string {
  if (raw.startsWith(GO_KEYRING_PREFIX)) {
    return Buffer.from(raw.slice(GO_KEYRING_PREFIX.length), 'base64').toString('utf-8')
  }
  return raw
}

function esc(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}
