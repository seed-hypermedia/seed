import {keyPairStore, type LocalWebIdentity} from '@/auth'
import {webUniversalClient} from '@/universal-client'
import type {HMDocument, HMMetadata, HMNavigationItem, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {SEED_HOST_URL} from '@shm/shared/constants'
import {getQueryClient, invalidateQueries} from '@shm/shared/models/query-client'
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

function parseSiteUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Use a complete web address starting with https:// or http://.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use a web address starting with https:// or http://, without a username or password.')
  }
  return url
}

function publicSiteOrigin(value: string): string {
  return parseSiteUrl(value).origin
}

async function fetchSite(origin: string, path: string, options?: RequestInit) {
  try {
    return await fetch(`${origin}${path}`, {credentials: 'omit', ...options})
  } catch {
    // Browser network/CORS errors cannot be distinguished reliably. Never echo
    // the setup URL or a fetch error that could contain its registration secret.
    throw new Error(
      `Could not connect to ${origin}. Check that the server is running and allows browser requests from this site (CORS). For HTTPS, also check its certificate, then try again.`,
    )
  }
}

async function siteResponse(response: Response) {
  const data = await response.json().catch(() => {
    throw new Error('The site returned an unreadable response. Please try again.')
  })
  if (!response.ok) throw new Error(data.message || `The site returned status ${response.status}.`)
  return data
}

async function readSiteConfig(origin: string) {
  const response = await fetchSite(origin, '/hm/api/config')
  return siteConfigSchema.parse(await siteResponse(response))
}

/** Connect a hosting setup URL to the owner's space, then publish its web address using the browser delegation. */
export async function registerSite(accountUid: string, setupUrl: string): Promise<string> {
  const identity = requireSiteOwner(accountUid)
  const setup = parseSiteUrl(setupUrl)
  const isLoopback =
    setup.hostname === 'localhost' ||
    setup.hostname.endsWith('.localhost') ||
    setup.hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(setup.hostname)
  if (new URL(window.location.origin).protocol === 'https:' && setup.protocol === 'http:' && !isLoopback) {
    throw new Error(
      'This page uses HTTPS, so your browser cannot connect to an HTTP hosting server. Enable HTTPS on that server and use its HTTPS setup URL. Localhost HTTP is allowed for development.',
    )
  }
  // Verify publication rights and existence before consuming a registration secret.
  await loadHome(accountUid)
  const siteUrl = setup.origin
  const config = await readSiteConfig(siteUrl)
  if (config.registeredAccountUid && config.registeredAccountUid !== accountUid) {
    throw new Error(`${siteUrl} is already registered to another space.`)
  }
  if (!config.registeredAccountUid) {
    const registrationSecret = setup.searchParams.get('secret')
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
    const response = await fetchSite(siteUrl, '/hm/api/register', {
      method: 'POST',
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
  // Site creation fetches the reservation before registration assigns its space.
  // Refresh ownership before offering custom-domain setup for the newly published site.
  await getQueryClient().invalidateQueries({queryKey: ['HOST_SITES', SEED_HOST_URL]})
  return siteUrl
}

/** Browser counterpart of the desktop site's registration mutation. */
export function useSiteRegistration(accountUid: string) {
  return useMutation({mutationFn: ({url}: {url: string}) => registerSite(accountUid, url)})
}

type HomeDocumentUpdate = {
  metadata?: HMMetadata
  /** Merge edited fields with the latest published metadata to preserve concurrent changes. */
  updateMetadata?: (current: HMMetadata) => HMMetadata
  navigation?: HMNavigationItem[]
}

/** Publish only requested home metadata/navigation edits using its latest version and owner delegation. */
export async function updateHomeDocument(
  accountUid: string,
  {metadata, updateMetadata, navigation}: HomeDocumentUpdate,
) {
  const identity = requireSiteOwner(accountUid)
  const document = await loadHome(accountUid)
  const nextMetadata = updateMetadata ? updateMetadata(document.metadata) : metadata
  await publishHomeChanges(accountUid, identity, document, [
    ...(nextMetadata ? getDocAttributeChanges(nextMetadata, document.metadata) : []),
    ...(navigation ? getNavigationChanges(navigation, document.detachedBlocks?.navigation) : []),
  ])
}

/** Update a space's home metadata or navigation with its current version and delegated owner signature. */
export function useUpdateHomeDocument(accountUid: string) {
  return useMutation({mutationFn: (input: HomeDocumentUpdate) => updateHomeDocument(accountUid, input)})
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
