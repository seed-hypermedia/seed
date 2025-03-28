import {getAllAbilitiesByOrigin, getStoredLocalKeys, resetDB} from '@/local-db'
import {
  EmbedSigningDelegateMessage,
  EmbedSigningIdentityProviderMessage,
  RequestSignCommentMessage,
} from '@/signing-embed-messages'
import {entityQueryPathToHmIdPath, hmId} from '@shm/shared'
import {base58btc} from 'multiformats/bases/base58'
import {signComment} from './api'
import {Ability, getValidAbility} from './auth-abilities'

declare global {
  interface Document {
    requestStorageAccess(options?: {
      indexedDB: boolean
    }): Promise<{indexedDB: IDBFactory} | void>
  }
}

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
    // Chrome supports options, Safari doesn't
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    console.log('~~ isSafari', isSafari)
    const requestPromise = isSafari
      ? document.requestStorageAccess()
      : document.requestStorageAccess({indexedDB: true})

    requestPromise
      .then(async (result) => {
        const indexedDB = isSafari
          ? window.indexedDB
          : result?.indexedDB || window.indexedDB
        resetDB(indexedDB)
        setInterval(() => updateAndBroadcastAbilities(origin), 1000) // todo, make fast again
      })
      .catch((error) => {
        console.error(
          '~~ requestStorageAccess error',
          error?.message || 'Unknown error',
          error,
        )
        // if (!isSafari) return
        // // Fallback for Safari - try to use storage anyway
        // try {
        //   resetDB(window.indexedDB)
        //   setInterval(() => updateAndBroadcastAbilities(origin), 1000)
        // } catch (e) {
        //   console.error('~~ fallback storage access error', e)
        // }
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
  // useEffect(() => {
  //   console.log('~~ embed sign page ready')
  //   sendParentMessage({type: 'ready'})
  //   const handleMessage = (event: MessageEvent) => {
  //     const message = embedSigningDelegateMessageSchema.parse(event.data)
  //     handleParentMessage(message, event.origin)
  //   }
  //   window.addEventListener('message', handleMessage)
  //   return () => window.removeEventListener('message', handleMessage)
  // }, [])
  return (
    <button
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'red',
      }}
      onClick={() => {
        const isSafari = /^((?!chrome|android).)*safari/i.test(
          navigator.userAgent,
        )
        if (isSafari) {
          document.hasStorageAccess().then((hasAccess) => {
            console.log('~~ hasStorageAccess', hasAccess)
          })
          indexedDB
            .databases()
            .then((dbs) => console.log('IndexedDB Instances:', dbs))
        }
        console.log('~~ IS safari', isSafari)
        document
          .requestStorageAccess({indexedDB: true})
          .then(async (result) => {
            const indexedDB = isSafari
              ? window.indexedDB
              : result?.indexedDB || window.indexedDB
            console.log('~~ CLICK REQUESTED STORAGE', result, indexedDB)
            indexedDB
              .databases()
              .then((dbs) => console.log('~~ 2 IndexedDB Instances:', dbs))

            document.hasStorageAccess().then((hasAccess) => {
              console.log(
                '~~ 22 hasStorageAccess',
                hasAccess,
                window.location.origin,
              )
            })

            resetDB(indexedDB).then((db) => {
              updateAndBroadcastAbilities(origin)
              indexedDB
                .databases()
                .then((dbs) => console.log('~~ 2 IndexedDB Instances:', dbs))
            })
            // setInterval(() => updateAndBroadcastAbilities(origin), 1000) // todo, make fast again
          })
          .catch((error) => {
            console.error(
              '~~ CLICK requestStorageAccess error',
              error?.message || 'Unknown error',
              error,
            )
          })
      }}
    >
      Embed Signing
    </button>
  )
}
