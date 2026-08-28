/**
 * Public surface of the mobile vault core for the UI layer.
 */

export {VaultApiError, VaultWriteConflictError} from './api'
export {
  buildVaultConnectionURL,
  CONNECT_TOKEN_EXPIRED_ERROR,
  CONNECTION_TOKEN_TTL_MS,
  normalizeVaultOriginURL,
} from './connect'
export {openURL} from './open-url'
export {updateProfile, type UpdateProfileInput, type UpdateProfileResult} from './profile'
export {buildSeedKeyExport, ENCRYPTED_SEEDKEY_ERROR, parseSeedKeyImport, type SeedKeyMaterial} from './seedkey'
export {
  createDefaultSecretStore,
  createMemorySecretStore,
  createNativeSecretStore,
  createWebSecretStore,
  type SecretStore,
} from './secret-store'
export {getIdentitySigner, publishAsIdentity, publishProfile} from './signing'
export {getVaultManager, resetVaultManager, VaultManager, type VaultIdentity, type VaultStatus} from './store'
