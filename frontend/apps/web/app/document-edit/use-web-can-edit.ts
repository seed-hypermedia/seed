import {useLocalKeyPair} from '@/auth'
import type {HMCapability, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useUniversalAppContext} from '@shm/shared'
import {WEB_IS_GATEWAY} from '@shm/shared/constants'
import {roleCanWrite} from '@shm/shared/models/capabilities'
import {useCapabilities} from '@shm/shared/models/entity'
import {useMemo} from 'react'

/**
 * Result of resolving whether the current web user can edit a document.
 * `signingAccountId` is the vault-delegated account that should sign publishes.
 */
export interface WebCanEditResult {
  canEdit: boolean
  signingAccountId: string | null
  /** The HMCapability that grants edit access (owner synthetic or matching writer/agent). */
  capability: HMCapability | null
  /** True while the capabilities lookup is still resolving (so `canEdit` is not yet final). */
  capabilitiesLoading: boolean
}

/**
 * Pure decision function for canEdit. Exported for unit testing.
 * Mirrors the rule documented in `useWebCanEdit`.
 */
export function resolveWebCanEdit(args: {
  docId: UnpackedHypermediaId | null | undefined
  delegatedAccountUid: string | null | undefined
  origin: string | null | undefined
  originHomeId: UnpackedHypermediaId | null | undefined
  capabilities: HMCapability[] | null | undefined
  isBrowser: boolean
  isGateway?: boolean
}): Omit<WebCanEditResult, 'capabilitiesLoading'> {
  if (!args.isBrowser) return {canEdit: false, signingAccountId: null, capability: null}
  if (!args.docId) return {canEdit: false, signingAccountId: null, capability: null}

  const signingAccountId = args.delegatedAccountUid ?? null
  if (!signingAccountId) return {canEdit: false, signingAccountId: null, capability: null}

  const isOwner = args.docId.uid === signingAccountId
  let capability: HMCapability | null = null
  const caps = args.capabilities ?? []

  if (isOwner) {
    capability =
      caps.find((c) => c.id === '_owner') ??
      ({
        id: '_owner',
        accountUid: signingAccountId,
        role: 'owner',
        grantId: args.docId,
        label: 'Owner',
        createTime: {seconds: 0, nanos: 0},
      } as HMCapability)
  } else {
    capability = caps.find((c) => c.accountUid === signingAccountId && roleCanWrite(c.role)) ?? null
  }

  if (!capability) return {canEdit: false, signingAccountId, capability: null}

  const isExternalSite =
    !args.isGateway && !!args.origin && !!args.originHomeId && args.originHomeId.uid !== args.docId.uid
  if (isExternalSite) return {canEdit: false, signingAccountId, capability}

  return {canEdit: true, signingAccountId, capability}
}

/**
 * Decide whether the logged-in web user can edit the given document.
 *
 * Rules:
 *  - Server-side: always returns `{canEdit: false, signingAccountId: null}`.
 *  - Local-only browser keys (no `delegatedAccountUid`) are V1-comment-only — `canEdit: false`.
 *  - Vault-delegated user is the doc owner -> canEdit (synthetic owner capability).
 *  - Vault-delegated user holds a WRITER/OWNER capability whose `accountUid` matches -> canEdit.
 *  - Site-scope filter: on a custom-domain site (`originHomeId.uid !== docId.uid`), edits are blocked.
 *    On the gateway (`WEB_IS_GATEWAY`) any authorized doc is editable.
 *
 * The check runs entirely in the browser. The capability lookup is cached via the existing
 * `useCapabilities` hook (React Query), keyed on `(docId.uid, ...path)`.
 */
export function useWebCanEdit(docId: UnpackedHypermediaId | null | undefined): WebCanEditResult {
  const userKeyPair = useLocalKeyPair()
  const {origin, originHomeId} = useUniversalAppContext()
  const capabilities = useCapabilities(docId ?? undefined)
  const capabilitiesLoading = capabilities.isLoading

  return useMemo<WebCanEditResult>(
    () => ({
      ...resolveWebCanEdit({
        docId,
        delegatedAccountUid: userKeyPair?.delegatedAccountUid,
        origin: origin ?? null,
        originHomeId: originHomeId ?? null,
        capabilities: capabilities.data,
        isBrowser: typeof window !== 'undefined',
        isGateway: WEB_IS_GATEWAY,
      }),
      capabilitiesLoading,
    }),
    [docId, userKeyPair?.delegatedAccountUid, capabilities.data, capabilitiesLoading, origin, originHomeId],
  )
}
