import {Ability, getAllAbilitiesByOrigin, getStoredLocalKeys} from '@/local-db'
import {
  EmbedSigningDelegateMessage,
  embedSigningDelegateMessageSchema,
  EmbedSigningIdentityProviderMessage,
  RequestSignCommentMessage,
} from '@/signing-embed-messages'
import {useEffect} from 'react'
import {signComment} from './api'

console.log('EmbedSignPage, window.location.origin', window.location.origin)

function sendParentMessage(message: EmbedSigningIdentityProviderMessage) {
  window.parent.postMessage(message, '*')
}

let lastSentAbilities: Ability[] | null = null
let lastSentAbilitiesJson: string | null = null

function broadcastAbilities(origin: string) {
  getAllAbilitiesByOrigin(origin).then((abilities) => {
    const abilitiesJson = JSON.stringify(abilities)
    if (lastSentAbilitiesJson !== abilitiesJson) {
      lastSentAbilities = abilities
      lastSentAbilitiesJson = abilitiesJson
      sendParentMessage({type: 'abilities', abilities})
    }
  })
}

async function handleCommentSignature(message: RequestSignCommentMessage) {
  console.log('~~ signing comment', message)
  const keyPair = await getStoredLocalKeys()
  if (!keyPair) {
    throw new Error('No key pair found')
  }
  const signedComment = await signComment(message.comment, keyPair)
  return signedComment
}

function handleParentMessage(
  message: EmbedSigningDelegateMessage,
  origin: string,
) {
  if (message.type === 'init') {
    broadcastAbilities(origin)
    setInterval(() => broadcastAbilities(origin), 100)
    return
  }
  if (message.type === 'requestSignComment') {
    handleCommentSignature(message)
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
