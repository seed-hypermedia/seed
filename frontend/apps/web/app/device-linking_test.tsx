import {StrictMode, useState, FormEvent, useEffect} from 'react'
import {createRoot} from 'react-dom/client'
import {linkDevice, LinkingResult, LinkingEvent} from './device-linking'
import * as cbor from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {preparePublicKey} from './auth-utils'
import type {DeviceLinkSession} from '@shm/shared/hm-types'

type LinkingState =
  | {
      state: 'result'
      result: LinkingResult
    }
  | {
      state: 'event'
      event: LinkingEvent
    }
  | {
      state: 'error'
      error: string
    }

const DeviceLinking = () => {
  const keyPair = useGenerateKey()
  const [sessionString, setSessionString] = useState('')
  const parsedSession = useParsedSession(sessionString)
  const [linkingState, setLinkingState] = useState<LinkingState | null>(null)

  if (linkingState && linkingState.state === 'result') {
    return <LinkSuccess linkResult={linkingState.result} />
  }

  const invalidSession = Boolean(sessionString && !parsedSession)

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()

    linkDevice(parsedSession!, keyPair!.keyPair, (e: LinkingEvent) => {
      console.log(e)
      setLinkingState({state: 'event', event: e})
    })
      .then((result) => {
        setLinkingState({state: 'result', result: result})
      })
      .catch((err) => {
        setLinkingState({state: 'error', error: err.message})
      })
  }

  return (
    <section>
      <section>
        {keyPair ? (
          <span>Generated {keyPair.id}</span>
        ) : (
          <span>Generating P256 Key...</span>
        )}
      </section>

      <form onSubmit={handleSubmit}>
        <div>
          <input
            id="sessionInput"
            name="sessionInput"
            type="text"
            onChange={(e) => setSessionString(e.target.value)}
            value={sessionString}
            placeholder="Enter your session token"
          />
        </div>

        {parsedSession && (
          <div>
            <h3>Parsed Session Data</h3>
            <pre style={{padding: '20px'}}>
              {JSON.stringify(parsedSession, null, 2)}
            </pre>
          </div>
        )}

        <button type="submit" disabled={invalidSession}>
          {invalidSession ? 'Invalid session string' : 'Link Device'}
        </button>
      </form>

      <section hidden={!linkingState}>
        <h3>Linking State</h3>
        <pre style={{padding: '20px'}}>
          {JSON.stringify(linkingState, null, 2)}
        </pre>
      </section>
    </section>
  )
}

const elem = document.getElementById('root')!
const app = (
  <StrictMode>
    <section>
      <h1>Device Linking Test</h1>
      <DeviceLinking />
    </section>
  </StrictMode>
)

if (import.meta.hot) {
  // With hot module reloading, `import.meta.hot.data` is persisted.
  const root = (import.meta.hot.data.root ??= createRoot(elem))
  root.render(app)
} else {
  // The hot module reloading API is not available in production.
  createRoot(elem).render(app)
}

function useGenerateKey() {
  const [keyPair, setKeyPair] = useState<{
    keyPair: CryptoKeyPair
    id: string
  } | null>(null)

  useEffect(() => {
    const generateKey = async () => {
      const kp = await window.crypto.subtle.generateKey(
        {
          name: 'ECDSA',
          namedCurve: 'P-256',
        },
        true,
        ['sign', 'verify'],
      )

      const id = await preparePublicKey(kp.publicKey)

      setKeyPair({
        keyPair: kp,
        id: base58btc.encode(id),
      })
      console.log('Generated P256 key pair:', kp)
    }

    generateKey()
  }, [])

  return keyPair
}

function useParsedSession(sessionString: string) {
  const [session, setSession] = useState<DeviceLinkSession | undefined>()

  useEffect(() => {
    if (!sessionString) {
      setSession(undefined)
      return
    }

    try {
      if (sessionString.startsWith('http')) {
        const url = new URL(sessionString)
        sessionString = url.hash.slice(1) // Trim the leading '#'.
      }

      const sessionBytes = base58btc.decode(sessionString)
      const sessionData = cbor.decode<DeviceLinkSession>(sessionBytes)
      setSession(sessionData)
    } catch (error) {
      console.log(error)
      setSession(undefined)
      return
    }
  }, [sessionString])

  return session
}

function LinkSuccess(props: {linkResult: LinkingResult}) {
  return (
    <section>
      <h3>Device linked successfully!</h3>
      <pre style={{padding: '20px'}}>
        {JSON.stringify(
          {
            browserAccountId: props.linkResult.browserAccountId,
            appAccountId: props.linkResult.appAccountId,
          },
          null,
          2,
        )}
      </pre>
    </section>
  )
}
