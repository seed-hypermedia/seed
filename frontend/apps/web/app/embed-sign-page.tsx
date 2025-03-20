import {getAllAbilitiesByOrigin, getStoredLocalKeys, resetDB} from '@/local-db'
import {
  EmbedSigningDelegateMessage,
  embedSigningDelegateMessageSchema,
  EmbedSigningIdentityProviderMessage,
  RequestSignCommentMessage,
} from '@/signing-embed-messages'
import {entityQueryPathToHmIdPath, hmId} from '@shm/shared'
import {base58btc} from 'multiformats/bases/base58'
import {useEffect} from 'react'
import {signComment} from './api'
import {Ability, getValidAbility} from './auth-abilities'

function sendParentMessage(message: EmbedSigningIdentityProviderMessage) {
  window.parent.postMessage(message, '*')
}

let lastSentAbilities: Ability[] | null = null
let lastSentAbilitiesJson: string | null = null

function updateAndBroadcastAbilities(origin: string) {
  getAllAbilitiesByOrigin(origin)
    .then((abilities) => {
      const abilitiesJson = JSON.stringify(abilities)
      if (lastSentAbilitiesJson !== abilitiesJson) {
        lastSentAbilities = abilities
        lastSentAbilitiesJson = abilitiesJson
        sendParentMessage({type: 'abilities', abilities})
      }
    })
    .catch((error) => {
      console.error('~~ updateAndBroadcastAbilities error', error)
    })
}

async function handleCommentSignature(
  message: RequestSignCommentMessage,
  origin: string,
) {
  const abilities = await getAllAbilitiesByOrigin(origin)
  const targetId = hmId('d', base58btc.encode(message.comment.space), {
    path: entityQueryPathToHmIdPath(message.comment.path),
  })
  const validAbility = getValidAbility(abilities, targetId, 'comment', origin)
  if (!validAbility) {
    // the real error here is that there is no ability. But we don't want to leak auth information to random origins, so we throw the same error
    throw new Error('NoIdentity')
  }
  const keyPair = await getStoredLocalKeys()
  if (!keyPair) {
    throw new Error('NoIdentity')
  }
  const signedComment = await signComment(message.comment, keyPair)
  return signedComment
}

function handleParentMessage(
  message: EmbedSigningDelegateMessage,
  origin: string,
) {
  if (message.type === 'init') {
    console.log('~~ embed init')
    document
      .requestStorageAccess({indexedDB: true})
      .then(async (result) => {
        const indexedDB = result.indexedDB
        resetDB(indexedDB)
        setInterval(() => updateAndBroadcastAbilities(origin), 1000) // todo, make fast again
      })
      .catch((error) => {
        console.error('~~ requestStorageAccess error', error)
      })
    return
  }
  if (message.type === 'requestSignComment') {
    handleCommentSignature(message, origin)
      .then((signedComment) => {
        sendParentMessage({
          type: 'resolveSignature',
          signatureId: message.signatureId,
          signature: signedComment.sig,
        })
      })
      .catch((error) => {
        sendParentMessage({
          type: 'rejectSignature',
          signatureId: message.signatureId,
          error: error.message,
        })
      })
    return
  }
  console.log('~~ unrecognized handleParentMessage', message)
}

export default function EmbedSignPage() {
  useEffect(() => {
    console.log('~~ embed sign page ready')
    sendParentMessage({type: 'ready'})
    const handleMessage = (event: MessageEvent) => {
      const message = embedSigningDelegateMessageSchema.parse(event.data)
      handleParentMessage(message, event.origin)
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])
  return <div>Embed Signing</div>
}
