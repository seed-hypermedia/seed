import {keyPairStore, type LocalWebIdentity} from '@/auth'
import {webUniversalClient} from '@/universal-client'
import type {HMDocument, HMMetadata, HMNavigationItem, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import type {PublishDocumentInput} from '@shm/shared/universal-client'
import {getDocAttributeChanges} from '@shm/shared/utils/document-changes'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {getNavigationChanges} from '@shm/shared/utils/navigation-changes'
import {useMutation} from '@tanstack/react-query'
import {z} from 'zod'

const siteConfigSchema = z.object({
  registeredAccountUid: z.string().nullish(),
  peerId: z.string().optional(),
  addrs: z.array(z.string()).optional(),
})

function requireSiteOwner(accountUid: string): LocalWebIdentity {
  const identity = keyPairStore.get()
  if (!identity?.capabilityCid || identity.delegatedAccountUid !== accountUid) {
    throw new Error('Sign in as the space owner before changing its publication.')
  }
  return identity
}

function checkIdentity(identity: LocalWebIdentity) {
  if (keyPairStore.get() !== identity) throw new Error('Your account changed. Please try again.')
}

async function loadHome(accountUid: string): Promise<HMDocument> {
  const resource = await webUniversalClient.request('Resource', hmId(accountUid, {latest: true}))
  if (resource.type !== 'document' || !resource.document.version || !resource.document.genesis) {
    throw new Error('Publish the space before setting up its web address.')
  }
  if (resource.document.visibility === 'PRIVATE') throw new Error('Only public spaces can be published to a domain.')
  return resource.document
}

async function publishHomeChanges(
  accountUid: string,
  identity: LocalWebIdentity,
  document: HMDocument,
  changes: PublishDocumentInput['changes'],
) {
  checkIdentity(identity)
  if (!webUniversalClient.publishDocument) throw new Error('Publishing is unavailable.')
  if (!changes.length) return
  await webUniversalClient.publishDocument({
    account: accountUid,
    signerAccountUid: accountUid,
    capability: identity.capabilityCid,
    baseVersion: document.version,
    genesis: document.genesis,
    generation: document.generationInfo?.generation,
    changes,
  })
  const id = hmId(accountUid)
  invalidateQueries([queryKeys.ENTITY, id.id])
  invalidateQueries([queryKeys.ACCOUNT, accountUid])
  invalidateQueries([queryKeys.RESOLVED_ENTITY, id.id])
}

function publicSiteOrigin(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use a web address starting with https:// or http://.')
  }
  return url.origin
}

async function siteResponse(response: Response) {
  const data = await response.json().catch(() => {
    throw new Error('The site returned an unreadable response. Please try again.')
  })
  if (!response.ok) throw new Error(data.message || `The site returned status ${response.status}.`)
  return data
}

async function readSiteConfig(origin: string) {
  const response = await fetch(`${origin}/hm/api/config`, {credentials: 'omit'})
  return siteConfigSchema.parse(await siteResponse(response))
}

/** Connect a hosting setup URL to the owner's space, then publish its web address using the browser delegation. */
export async function registerSite(accountUid: string, setupUrl: string): Promise<string> {
  const identity = requireSiteOwner(accountUid)
  // Verify publication rights and existence before consuming a registration secret.
  await loadHome(accountUid)
  const siteUrl = publicSiteOrigin(setupUrl)
  const config = await readSiteConfig(siteUrl)
  if (config.registeredAccountUid && config.registeredAccountUid !== accountUid) {
    throw new Error('This site is already registered to another space.')
  }
  if (!config.registeredAccountUid) {
    const registrationSecret = new URL(setupUrl).searchParams.get('secret')
    if (!registrationSecret) throw new Error('The setup URL is missing its registration secret.')
    // The browser publishes to its current web gateway; it has no local libp2p daemon.
    const source = await readSiteConfig(window.location.origin)
    if (!source.peerId || !source.addrs || (!source.addrs.length && config.peerId !== source.peerId)) {
      throw new Error('The publishing gateway does not expose a reachable peer. Please try again.')
    }
    // Public gateway config includes the peer suffix; registration adds it to
    // each address itself, as it does for addresses from the desktop daemon.
    const peerSuffix = `/p2p/${source.peerId}`
    const addrs = source.addrs.map((address) =>
      address.endsWith(peerSuffix) ? address.slice(0, -peerSuffix.length) : address,
    )
    checkIdentity(identity)
    const response = await fetch(`${siteUrl}/hm/api/register`, {
      method: 'POST',
      credentials: 'omit',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({registrationSecret, accountUid, peerId: source.peerId, addrs}),
    })
    await siteResponse(response)
  }
  // Registration may have succeeded on a previous attempt. Always use the latest
  // document when retrying the independently signed publication update.
  const document = await loadHome(accountUid)
  await publishHomeChanges(accountUid, identity, document, [
    {op: {case: 'setMetadata', value: {key: 'siteUrl', value: siteUrl}}},
  ])
  return siteUrl
}

/** Browser counterpart of the desktop site's registration mutation. */
export function useSiteRegistration(accountUid: string) {
  return useMutation({mutationFn: ({url}: {url: string}) => registerSite(accountUid, url)})
}

/** Update a space's home metadata or navigation with its current version and delegated owner signature. */
export function useUpdateHomeDocument(accountUid: string) {
  return useMutation({
    mutationFn: async ({metadata, navigation}: {metadata?: HMMetadata; navigation?: HMNavigationItem[]}) => {
      const identity = requireSiteOwner(accountUid)
      const document = await loadHome(accountUid)
      await publishHomeChanges(accountUid, identity, document, [
        ...(metadata ? getDocAttributeChanges(metadata, document.metadata) : []),
        ...(navigation ? getNavigationChanges(navigation, document.detachedBlocks?.navigation) : []),
      ])
    },
  })
}

/** Clear a publication address without deleting the hosted site or its content. */
export async function removeSite(id: UnpackedHypermediaId): Promise<null> {
  if (id.path?.length) throw new Error('Only a space home can have a web address.')
  const identity = requireSiteOwner(id.uid)
  const document = await loadHome(id.uid)
  await publishHomeChanges(id.uid, identity, document, [
    {op: {case: 'setMetadata', value: {key: 'siteUrl', value: ''}}},
  ])
  return null
}

/** Browser counterpart of the desktop publication removal mutation. */
export function useRemoveSite(id: UnpackedHypermediaId) {
  return useMutation({mutationFn: () => removeSite(id)})
}

/** Finish a hosting move or activated domain without replacing a custom domain or a newer publication choice. */
export async function updateMovedSitePublication(id: UnpackedHypermediaId, oldUrl: string, newUrl: string) {
  if (id.path?.length) throw new Error('Only a space home can have a web address.')
  const identity = requireSiteOwner(id.uid)
  const document = await loadHome(id.uid)
  if (document.metadata.siteUrl !== oldUrl) return
  await publishHomeChanges(id.uid, identity, document, [
    {op: {case: 'setMetadata', value: {key: 'siteUrl', value: publicSiteOrigin(newUrl)}}},
  ])
}
