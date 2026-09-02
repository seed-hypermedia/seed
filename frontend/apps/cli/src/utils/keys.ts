/**
 * Signing-key resolution across the vault and the legacy OS keyring.
 *
 * The daemon/desktop app stores identities in an encrypted vault file
 * (vault.json), read via the client SDK (`@seed-hypermedia/client/vault-local`).
 * Machines that never migrated still have keys in the OS keyring
 * (utils/keyring.ts). The vault is authoritative when both exist: after
 * migration the daemon archives the legacy keyring record, so keyring hits on
 * migrated machines are stale by definition.
 *
 * Vault access is READ-ONLY — vault writes (with remote sync and versioning)
 * are the daemon's job. Key creation/removal in the CLI stays on the keyring.
 */

import {loadLocalVaultAccounts, type VaultLocalAccount} from '@seed-hypermedia/client/vault-local'
import {loadConfig} from '../config'
import {printWarning} from '../output'
import {deriveKeyPairFromMnemonic} from './key-derivation'
import {getDefaultKey, getKey, listKeys, type KeyringKey} from './keyring'

export type KeySource = 'vault' | 'keyring' | 'env'

export type ResolvedKey = KeyringKey & {source: KeySource}

export type KeyInfo = {
  name: string
  accountId: string
  source: KeySource
}

export type KeyOptions = {
  /** Use the dev environment (dev keyring service, Seed-dev vault location). */
  dev: boolean
  /** Explicit vault.json path from the --vault flag. */
  vault?: string
}

/**
 * Loads vault accounts. Errors are fatal when a vault path was named
 * explicitly (flag, config, or env); otherwise they degrade to a warning so
 * keyring-only setups keep working.
 */
async function loadVault(opts: KeyOptions): Promise<VaultLocalAccount[]> {
  const path = opts.vault || loadConfig().vaultPath || undefined
  try {
    return (await loadLocalVaultAccounts({path, dev: opts.dev})) ?? []
  } catch (error) {
    if (path || process.env.SEED_VAULT_PATH) throw error
    printWarning(`Ignoring vault: ${(error as Error).message}`)
    return []
  }
}

function toResolvedKey(account: VaultLocalAccount): ResolvedKey {
  return {
    name: account.name,
    privateKey: account.seed,
    publicKey: account.publicKey,
    publicKeyWithPrefix: account.publicKeyWithPrefix,
    accountId: account.accountId,
    source: 'vault',
  }
}

/** Finds a key by name or account ID: vault first, then keyring. */
export async function findKey(nameOrAccountId: string, opts: KeyOptions): Promise<ResolvedKey | null> {
  const accounts = await loadVault(opts)
  const vaultMatch =
    accounts.find((a) => a.name === nameOrAccountId) ?? accounts.find((a) => a.accountId === nameOrAccountId)
  if (vaultMatch) return toResolvedKey(vaultMatch)

  const keyringKey = getKey(nameOrAccountId, opts.dev)
  return keyringKey ? {...keyringKey, source: 'keyring'} : null
}

/**
 * Finds the default signing key.
 * Priority: config defaultAccount (vault, then keyring) > key named "main"
 * (vault, then keyring) > first vault account > keyring default.
 */
export async function findDefaultKey(opts: KeyOptions): Promise<ResolvedKey | null> {
  const accounts = await loadVault(opts)
  const config = loadConfig()

  if (config.defaultAccount) {
    const vaultMatch = accounts.find((a) => a.accountId === config.defaultAccount)
    if (vaultMatch) return toResolvedKey(vaultMatch)
    const keyringMatch = getKey(config.defaultAccount, opts.dev)
    if (keyringMatch) return {...keyringMatch, source: 'keyring'}
  }

  const vaultMain = accounts.find((a) => a.name === 'main')
  if (vaultMain) return toResolvedKey(vaultMain)
  const keyringMain = getKey('main', opts.dev)
  if (keyringMain) return {...keyringMain, source: 'keyring'}

  if (accounts.length > 0) return toResolvedKey(accounts[0]!)
  const keyringDefault = getDefaultKey(opts.dev)
  return keyringDefault ? {...keyringDefault, source: 'keyring'} : null
}

/**
 * Resolves the signing key from an optional --key flag, falling back to the
 * default. Throws with actionable guidance when nothing is found.
 */
export async function resolveSigningKey(keyFlag: string | undefined, opts: KeyOptions): Promise<ResolvedKey> {
  const envHint = opts.dev ? ' --dev' : ''

  // Non-interactive environments (CI) pass the key as a mnemonic in
  // SEED_CLI_MNEMONIC; it wins over every stored key.
  const envMnemonic = process.env.SEED_CLI_MNEMONIC?.trim()
  if (envMnemonic) {
    const pair = deriveKeyPairFromMnemonic(envMnemonic)
    if (keyFlag && keyFlag !== 'env' && keyFlag !== pair.accountId) {
      throw new Error(`SEED_CLI_MNEMONIC is set (account ${pair.accountId}) but --key ${keyFlag} was requested.`)
    }
    return {name: 'env', ...pair, source: 'env'}
  }

  if (keyFlag) {
    const key = await findKey(keyFlag, opts)
    if (!key) {
      throw new Error(`Key "${keyFlag}" not found. Use "seed-cli key list${envHint}" to see available keys.`)
    }
    return key
  }

  const key = await findDefaultKey(opts)
  if (!key) {
    throw new Error(
      `No signing keys found. Use "seed-cli key generate${envHint}" or "seed-cli key import${envHint}" first, ` +
        'or check that your vault is accessible with "seed-cli key list".',
    )
  }
  return key
}

/** Lists all known keys: vault identities first, then keyring keys. */
export async function listAllKeys(opts: KeyOptions): Promise<KeyInfo[]> {
  const accounts = await loadVault(opts)
  return [
    ...accounts.map((a): KeyInfo => ({name: a.name, accountId: a.accountId, source: 'vault'})),
    ...listKeys(opts.dev).map((k): KeyInfo => ({...k, source: 'keyring'})),
  ]
}

/** Extracts KeyOptions from commander global options. */
export function keyOptions(globalOpts: Record<string, unknown>): KeyOptions {
  return {
    dev: !!globalOpts.dev,
    vault: (globalOpts.vault as string | undefined) || undefined,
  }
}
