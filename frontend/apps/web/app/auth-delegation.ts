import {HMBlockNode, UnpackedHypermediaId} from '@shm/shared'
import {useSyncExternalStore} from 'react'
import {createSignedComment, createUnsignedComment, SignedComment} from './api'
import {
  Ability,
  addDelegatedIdentityOrigin,
  getAllDelegatedIdentityOrigins,
  removeDelegatedIdentityOrigin,
} from './local-db'
import {
  EmbedSigningDelegateMessage,
  embedSigningIdentityProviderMessage,
  EmbedSigningIdentityProviderMessage,
} from './signing-embed-messages'

let delegatedIdentityOriginsState: string[] = []
const delegatedIdentityOriginHandlers = new Set<() => void>()

export const delegatedIdentityOriginStore = {
  get: () => delegatedIdentityOriginsState,
  add: async (origin: string) => {
    await addDelegatedIdentityOrigin(origin)
    delegatedIdentityOriginsState.push(origin)
    delegatedIdentityOriginHandlers.forEach((callback) => callback())
  },
  remove: async (origin: string) => {
    await removeDelegatedIdentityOrigin(origin)
    delegatedIdentityOriginsState = delegatedIdentityOriginsState.filter(
      (o) => o !== origin,
    )
    delegatedIdentityOriginHandlers.forEach((callback) => callback())
  },
  subscribe: (callback: () => void) => {
    delegatedIdentityOriginHandlers.add(callback)
    return () => {
      delegatedIdentityOriginHandlers.delete(callback)
    }
  },
} as const

if (typeof window !== 'undefined') {
  getAllDelegatedIdentityOrigins()
    .then(async (origins) => {
      delegatedIdentityOriginsState = origins
      delegatedIdentityOriginHandlers.forEach((callback) => callback())
    })
    .catch((err) => {
      console.error('Error getAllDelegatedIdentityOrigins', err)
    })
  window.addEventListener('message', (event) => {
    try {
      const message = embedSigningIdentityProviderMessage.parse(event.data)
      handleIframeMessage(event.origin, message)
    } catch (error) {
      // console.error('Error parsing message', error)
    }
  })
}

delegatedIdentityOriginStore.subscribe(() => {
  const reviewedOrigins = new Set<string>()
  delegatedIdentityOriginStore.get().forEach((origin) => {
    if (origin === '') return
    if (reviewedOrigins.has(origin)) return
    reviewedOrigins.add(origin)
    if (!delegatedIdentityIframes[origin]) {
      delegatedIdentityIframes[origin] = addOriginIframe(origin)
    }
  })
  Object.entries(delegatedIdentityIframes).forEach(([origin, child]) => {
    if (!reviewedOrigins.has(origin)) {
      child.remove()
      delete delegatedIdentityIframes[origin]
    }
  })
})

const pendingSignatures: Record<
  string,
  {resolve: (signature: ArrayBuffer) => void; reject: (error: Error) => void}
> = {}

const delegatedIdentityIframes: Record<
  string,
  {
    iframe: HTMLIFrameElement
    send: (message: EmbedSigningDelegateMessage) => void
    remove: () => void
  }
> = {}

function addOriginIframe(origin: string) {
  const iframe = document.createElement('iframe')
  const src = `${origin}/hm/embed/sign`
  iframe.src = src
  iframe.setAttribute(
    'sandbox',
    'allow-storage-access-by-user-activation allow-scripts allow-same-origin storage-access',
  )
  iframe.setAttribute('allow', 'storage-access')
  // iframe.style.display = 'none'
  function send(message: EmbedSigningDelegateMessage) {
    iframe.contentWindow?.postMessage(message, origin)
  }
  function remove() {
    iframe.remove()
  }
  document.body.appendChild(iframe)
  return {iframe, send, remove}
}

function handleIframeMessage(
  origin: string,
  message: EmbedSigningIdentityProviderMessage,
) {
  if (message.type === 'ready') {
    delegatedIdentityIframes[origin].send({type: 'init'})
  } else if (message.type === 'abilities') {
    delegatedAbilitiesStore.writeOriginAbilities(origin, message.abilities)
  } else if (message.type === 'resolveSignature') {
    pendingSignatures[message.signatureId].resolve(message.signature)
    delete pendingSignatures[message.signatureId]
  } else if (message.type === 'rejectSignature') {
    pendingSignatures[message.signatureId].reject(new Error(message.error))
    delete pendingSignatures[message.signatureId]
  }
}

let delegatedAbilitiesState: Ability[] = []
const delegatedAbilitiesHandlers = new Set<() => void>()

const delegatedAbilitiesStore = {
  get: () => delegatedAbilitiesState,
  writeOriginAbilities: (identityOrigin: string, abilities: Ability[]) => {
    let newAbilities = abilities.filter(
      (ability) => ability.identityOrigin === identityOrigin,
    )
    newAbilities.push(...abilities)
    delegatedAbilitiesState = newAbilities
    delegatedAbilitiesHandlers.forEach((callback) => callback())
  },
  subscribe: (callback: () => void) => {
    delegatedAbilitiesHandlers.add(callback)
    return () => {
      delegatedAbilitiesHandlers.delete(callback)
    }
  },
} as const

export function useDelegatedAbilities() {
  return useSyncExternalStore(
    delegatedAbilitiesStore.subscribe,
    delegatedAbilitiesStore.get,
    () => [],
  )
}

export async function createDelegatedComment({
  ability,
  content,
  docId,
  docVersion,
  replyCommentId,
  rootReplyCommentId,
}: {
  ability: Ability
  content: HMBlockNode[]
  docId: UnpackedHypermediaId
  docVersion: string
  replyCommentId?: string | null
  rootReplyCommentId?: string | null
}): Promise<SignedComment | null> {
  const unsignedComment = createUnsignedComment({
    content,
    docId,
    docVersion,
    signerKey: ability.accountPublicKey,
    replyCommentId,
    rootReplyCommentId,
  })
  const signatureId = crypto.randomUUID()
  delegatedIdentityIframes[ability.identityOrigin].send({
    type: 'requestSignComment',
    comment: unsignedComment,
    signatureId,
  })
  const signature = await new Promise<ArrayBuffer>((resolve, reject) => {
    pendingSignatures[signatureId] = {resolve, reject}
  }).catch((error) => {
    if (error.message === 'NoIdentity') {
      // So the identity is not available. We should consider this ability gone.
      delegatedIdentityOriginStore.remove(ability.identityOrigin)
      return null
    }
  })
  if (!signature) {
    return null
  }
  const signedComment = createSignedComment(unsignedComment, signature)
  return signedComment
}
