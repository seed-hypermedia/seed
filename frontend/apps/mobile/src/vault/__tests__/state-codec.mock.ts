/**
 * Test double for ../state-codec.
 *
 * The real module re-exports the Go-parity codec (`serializeState`/
 * `deserializeState`) and merge (`@seed-hypermedia/client/vault-merge`), which
 * are built concurrently in the client package. Unit tests here exercise the
 * MOBILE layers (envelope, versioning, sync bookkeeping), so this double
 * provides:
 * - the client codec when the Go-parity exports exist, falling back to the
 *   legacy `serialize`/`deserialize` (equivalent while no test uses duplicate
 *   display names — which none does), and
 * - a principal-keyed union merge with max-wins tombstones, matching the Go
 *   semantics the tests rely on.
 */

import type {Account, State} from '@seed-hypermedia/client/vault'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const vault = jest.requireActual('@seed-hypermedia/client/vault') as typeof import('@seed-hypermedia/client/vault') & {
  serializeState?: (data: State) => Promise<Uint8Array>
  deserializeState?: (compressed: Uint8Array) => Promise<State>
}

export const accountIdFromSeed = vault.accountIdFromSeed
export const createEmpty = vault.createEmpty
export const getAccountName = vault.getAccountName
export const VAULT_VERSION = vault.VAULT_VERSION

export const serializeState: (data: State) => Promise<Uint8Array> = vault.serializeState ?? vault.serialize
export const deserializeState: (compressed: Uint8Array) => Promise<State> = vault.deserializeState ?? vault.deserialize

function canonicalize(state: State) {
  return {
    notificationServerUrl: state.notificationServerUrl ?? '',
    deletedAccounts: Object.fromEntries(Object.entries(state.deletedAccounts ?? {}).sort()),
    accounts: state.accounts
      .map((account) => ({
        principal: vault.accountIdFromSeed(account.seed),
        name: vault.getAccountName(account),
        seed: Array.from(account.seed),
        createTime: account.createTime,
        delegations: account.delegations.length,
      }))
      .sort((a, b) => (a.principal < b.principal ? -1 : a.principal > b.principal ? 1 : 0)),
  }
}

export function statesEqual(left: State, right: State): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
}

export function mergeStates(
  local: State,
  remote: State,
  _localVersion: number,
  _remoteVersion: number,
): {merged: State; changedFromLocal: boolean} {
  const tombstones: Record<string, number> = {...(remote.deletedAccounts ?? {})}
  for (const [principal, deletedAt] of Object.entries(local.deletedAccounts ?? {})) {
    tombstones[principal] = Math.max(tombstones[principal] ?? 0, deletedAt)
  }

  const byPrincipal = new Map<string, Account>()
  for (const account of remote.accounts) {
    byPrincipal.set(vault.accountIdFromSeed(account.seed), account)
  }
  for (const account of local.accounts) {
    // Simplified tiebreak: local wins (sufficient for the mobile unit tests).
    byPrincipal.set(vault.accountIdFromSeed(account.seed), account)
  }

  const accounts: Account[] = []
  for (const [principal, account] of [...byPrincipal.entries()].sort()) {
    const tombstone = tombstones[principal] ?? 0
    if (tombstone > 0 && tombstone >= account.createTime) continue
    delete tombstones[principal]
    accounts.push(account)
  }

  const merged: State = {
    version: 2,
    accounts,
    ...(Object.keys(tombstones).length > 0 ? {deletedAccounts: tombstones} : {}),
    ...(local.notificationServerUrl || remote.notificationServerUrl
      ? {notificationServerUrl: local.notificationServerUrl || remote.notificationServerUrl}
      : {}),
  }

  return {merged, changedFromLocal: !statesEqual(local, merged)}
}
