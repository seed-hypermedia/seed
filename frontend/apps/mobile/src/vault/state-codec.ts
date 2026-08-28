/**
 * Single import chokepoint for the Go-parity vault state codec and merge.
 *
 * Mobile must NEVER use the legacy `serialize`/`deserialize`/`decryptVaultState`
 * exports of @seed-hypermedia/client/vault — they dedupe accounts by display
 * name on both encode and decode, which silently destroys identities that Go's
 * merge legitimately produces (two accounts sharing a name). Only the
 * Go-parity `serializeState`/`deserializeState` and the vault-merge module are
 * allowed through here, so a grep for the legacy names stays clean and unit
 * tests can mock one module.
 */

export {
  accountIdFromSeed,
  createEmpty,
  deserializeState,
  getAccountName,
  serializeState,
  VAULT_VERSION,
} from '@seed-hypermedia/client/vault'
export type {Account, DelegatedSession, State} from '@seed-hypermedia/client/vault'

export {mergeStates, statesEqual} from '@seed-hypermedia/client/vault-merge'
