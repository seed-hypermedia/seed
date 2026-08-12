import {createSeedClient} from '@seed-hypermedia/client'
import type {JsonValue} from '@bufbuild/protobuf'
import type {HMSigner, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {UniversalClient} from '@shm/shared'
import * as blobs from '@shm/shared/blobs'
import {AuthenticateRequest} from '@shm/shared/client/grpc-types'
import {
  ListAccountsRequest,
  ListAccountsResponse,
  ListDocumentAttributeNamesRequest,
  ListDocumentAttributeNamesResponse,
  ListDocumentAttributeValuesRequest,
  ListDocumentAttributeValuesResponse,
  QueryDocumentsResponse,
  type QueryDocumentsRequest,
} from '@shm/shared/client/grpc-types'
import {createWebUniversalClient} from '@shm/shared/create-web-universal-client'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {peerIdFromString} from '@libp2p/peer-id'
import {keyPairStore, type LocalWebIdentity} from './auth'
import {preparePublicKey, signWithKeyPair} from './auth-utils'
import WebCommenting from './commenting'
import {deleteRecent, getRecents} from './local-db-recents'

let daemonAuthRefresh: Promise<void> | null = null
let lastAuthenticatedKeyPairId: string | null = null
let daemonAuthExpiresAt = 0
let authGeneration = 0
let authAbortController: AbortController | null = null
const DAEMON_AUTH_REFRESH_INTERVAL_MS = 10 * 24 * 60 * 60 * 1000
const AUTH_REFRESH_SKEW_MS = 5 * 60 * 1000

function logDaemonAuthError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return
  }
  console.error(error)
}

async function ensureDaemonAuth(): Promise<void> {
  const kp = keyPairStore.get()
  if (!kp) {
    resetDaemonAuthState()
    return
  }

  const now = Date.now()

  if (lastAuthenticatedKeyPairId !== kp.id) {
    resetDaemonAuthState()
    lastAuthenticatedKeyPairId = kp.id
  } else if (daemonAuthRefresh) {
    await daemonAuthRefresh
    return
  } else if (daemonAuthExpiresAt - AUTH_REFRESH_SKEW_MS > now) {
    return
  }

  const generation = ++authGeneration
  const abortController = new AbortController()
  authAbortController = abortController
  daemonAuthRefresh = refreshDaemonAuth(kp, abortController.signal)
    .then(() => {
      if (generation === authGeneration && keyPairStore.get()?.id === kp.id) {
        daemonAuthExpiresAt = Date.now() + DAEMON_AUTH_REFRESH_INTERVAL_MS
      } else if (!keyPairStore.get()) {
        fetch('/hm/api/auth', {method: 'DELETE', credentials: 'include'}).catch(logDaemonAuthError)
      }
    })
    .finally(() => {
      if (generation === authGeneration) {
        daemonAuthRefresh = null
        authAbortController = null
      }
    })
  await daemonAuthRefresh
}

if (typeof window !== 'undefined') {
  ensureDaemonAuth().catch(logDaemonAuthError)
  keyPairStore.subscribe(() => {
    ensureDaemonAuth().catch(logDaemonAuthError)
  })
}

function resetDaemonAuthState() {
  authGeneration += 1
  authAbortController?.abort()
  authAbortController = null
  daemonAuthRefresh = null
  lastAuthenticatedKeyPairId = null
  daemonAuthExpiresAt = 0
}

async function refreshDaemonAuth(kp: LocalWebIdentity, signal: AbortSignal): Promise<void> {
  const configResponse = await fetch('/hm/api/config', {credentials: 'include', signal})
  if (!configResponse.ok) {
    const body = await configResponse.text().catch(() => 'unknown')
    throw new Error(`/hm/api/config failed: ${configResponse.status} ${body}`)
  }

  const config = (await configResponse.json()) as {peerId?: string}
  if (!config.peerId) {
    throw new Error('/hm/api/config missing peerId')
  }

  const daemonPeer = peerIdFromString(config.peerId)
  if (daemonPeer.type !== 'Ed25519') {
    throw new Error(`daemon peer is not Ed25519: ${daemonPeer.type}`)
  }

  const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  const signer = new blobs.WebCryptoKeyPair(kp, rawPublicKey)
  const caller = signer.principal
  const audience = blobs.principalFromEd25519(daemonPeer.publicKey.raw)
  const timestamp = Date.now() as blobs.Timestamp
  const assertion = await blobs.sign(signer, {
    type: 'Capability',
    signer: caller,
    sig: new Uint8Array(blobs.ED25519_SIGNATURE_SIZE),
    ts: timestamp,
    delegate: caller,
    audience,
  } satisfies blobs.Blob)

  const response = await fetch('/hm/api/auth', {
    method: 'POST',
    credentials: 'include',
    headers: {'Content-Type': 'application/protobuf'},
    body: new AuthenticateRequest({
      account: caller,
      timestamp: BigInt(timestamp),
      signature: assertion.sig,
    }).toBinary(),
    signal,
  })
  if (!response.ok) {
    const body = await response.text().catch(() => 'unknown')
    throw new Error(`/hm/api/auth failed: ${response.status} ${body}`)
  }

  return
}

async function daemonAuthHeaders(): Promise<Record<string, string>> {
  await ensureDaemonAuth()
  return {}
}

const seedClient = createSeedClient('', {headers: daemonAuthHeaders})

async function postDocumentRpc<Request extends {toJson(): unknown}, Response>(
  key: string,
  request: Request,
  decode: (value: JsonValue) => Response,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetch(`/api/${key}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/cbor'},
    body: cborEncode(request.toJson()),
    signal,
  })
  if (!response.ok) throw new Error(`${key} failed: ${response.status} ${await response.text()}`)
  const value: unknown = await response.json()
  if (!isJsonValue(value)) throw new Error(`${key} returned an invalid JSON payload`)
  return decode(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number')
    return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== 'object') return false
  return Object.values(value).every(isJsonValue)
}

export const webUniversalClient = createWebUniversalClient({
  request: seedClient.request as UniversalClient['request'],
  publish: seedClient.publish,
  queryDocuments: async (request: QueryDocumentsRequest, options) => {
    return postDocumentRpc('QueryDocuments', request, QueryDocumentsResponse.fromJson, options?.signal)
  },
  listAccounts: async (request, options) =>
    postDocumentRpc('ListAccounts', request, ListAccountsResponse.fromJson, options?.signal),
  listDocumentAttributeNames: async (request, options) =>
    postDocumentRpc(
      'ListDocumentAttributeNames',
      request,
      ListDocumentAttributeNamesResponse.fromJson,
      options?.signal,
    ),
  listDocumentAttributeValues: async (request, options) =>
    postDocumentRpc(
      'ListDocumentAttributeValues',
      request,
      ListDocumentAttributeValuesResponse.fromJson,
      options?.signal,
    ),
  CommentEditor: ({docId}: {docId: UnpackedHypermediaId}) => {
    return <WebCommenting key={docId.id} docId={docId} />
  },
  fetchRecents: getRecents,
  deleteRecent: deleteRecent,
  getSigner: (): HMSigner => ({
    getPublicKey: async () => {
      const kp = keyPairStore.get()
      if (!kp) throw new Error('No signing keys available')
      return preparePublicKey(kp.publicKey)
    },
    sign: async (data: Uint8Array) => {
      const kp = keyPairStore.get()
      if (!kp) throw new Error('No signing keys available')
      return signWithKeyPair(kp, new Uint8Array(data))
    },
  }),
})
