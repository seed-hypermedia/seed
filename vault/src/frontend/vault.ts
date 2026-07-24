/**
 * Vault data model and CBOR+compression serialization.
 *
 * The implementation lives in the shared client SDK
 * (`@seed-hypermedia/client/vault`) so that every consumer — this web app, the
 * CLI, and other tools — uses one byte-compatible codec. This module re-exports
 * it under the app's historical import path.
 */

export {
  createEmpty,
  deserialize,
  getAccountName,
  serialize,
  VAULT_VERSION,
  type Account,
  type CapabilityMeta,
  type DelegatedSession,
  type State,
} from '@seed-hypermedia/client/vault'
