import {yamux} from '@chainsafe/libp2p-yamux'
import * as cbor from '@ipld/dag-cbor'
import {circuitRelayTransport} from '@libp2p/circuit-relay-v2'
import {identify} from '@libp2p/identify'
import {Stream} from '@libp2p/interface'
import {ping} from '@libp2p/ping'
import {webRTC, webRTCDirect} from '@libp2p/webrtc'
import {multiaddr} from '@multiformats/multiaddr'
import {DeviceLinkSession} from '@shm/shared/hm-types'
import {lpStream} from 'it-length-prefixed-stream'
import {createLibp2p} from 'libp2p'
import {base58btc} from 'multiformats/bases/base58'
import {
  AgentCapability,
  Profile,
  signAgentCapability,
  signProfileAlias,
} from './auth-utils'

import {preparePublicKey} from './auth-utils'

/**
 * EncodedBlob contains the decoded blob data, and its encoded raw form.
 */
export type EncodedBlob<T> = {
  data: T
  raw: Uint8Array
}

/** LinkingResult is the result of the device linking process. */
export type LinkingResult = {
  browserAccountId: string
  appAccountId: string
  profileAlias: EncodedBlob<Profile>
  browserToAppCap: EncodedBlob<AgentCapability>
  appToBrowserCap: EncodedBlob<AgentCapability>
}

export const protocolId = '/hypermedia/devicelink/0.1.0'

export type EventDialing = {
  type: 'dialing'
  addr: string
}

export type EventDialError = {
  type: 'dial-error'
  addr: string
  error: Error
}

export type EventDialOK = {
  type: 'dial-ok'
  addr: string
}

/** LinkingEvent describes things that happen during the device linking process. */
export type LinkingEvent = EventDialing | EventDialError | EventDialOK

/**
 * Runs the device linking procedure using libp2p to connection to the "parent"
 * node to which the given key pair is going to be linked.
 * @param session - Connection details for the device link session.
 * @param keyPair - The key pair that will be linked to the parent key.
 * @param onEvent - Callback for handling various events that occur during the linking process.
 * @returns The result of the linking session, including all the blobs that were created in the process.
 */
export async function linkDevice(
  session: DeviceLinkSession,
  keyPair: CryptoKeyPair,
  onEvent: (event: LinkingEvent) => void = () => {},
): Promise<LinkingResult> {
  const publicKey = await preparePublicKey(keyPair.publicKey)

  // Create libp2p node with browser-specific configuration
  const node = await createLibp2p({
    transports: [
      // Prioritize WebRTC transports for browser environment
      webRTCDirect(),
      webRTC(),
      circuitRelayTransport(),
    ],
    services: {
      ping: ping(),
      identify: identify(),
    },
    streamMuxers: [yamux()],
    connectionGater: {
      // Allow all dials to prevent blocking dials to localhost.
      denyDialMultiaddr(multiaddr) {
        return false
      },
    },
  })

  const addrs = session.addrInfo.addrs
    // We can only dial webrtc-direct addresses, so we filter out the rest.
    .filter((a) => a.includes('webrtc-direct'))
    // For simplicity we prioritize localhost addresses first,
    // in addition we sort the p2p-circuit addresses last —
    // our common use case is for both devices to be on the same network,
    // so we want to exhaust the local addresses first.
    .sort((a, b) => {
      if (a.includes('127.0.0.1') && !b.includes('127.0.0.1')) {
        return -1
      }

      if (!a.includes('p2p-circuit') && b.includes('p2p-circuit')) {
        return -1
      }

      return +1
    })

  let stream: Stream | undefined

  // Instead of absorbing all addresses into the peerstore,
  // we manually attempt to dial each addresses for better control.
  // Otherwise it's unclear how libp2p prioritizes the addresses,
  // and it often times out on the first few addresses.
  for (const a of addrs) {
    const ma = multiaddr(a + '/p2p/' + session.addrInfo.peerId)

    // We do explicit timeout here, because sometimes p2p-circuit
    // addresses would hang in the middle of the dial — we would connect to the relay node,
    // but we won't pass through our actual target peer — and in this case the dial would hang forever.
    // Usually relays should just work, but sometimes they don't.
    // Because our common use case is for both devices to be on the same network,
    // connecting via relay is actually not mandatory, so we don't want to get stuck on it,
    // hence we set an explicit timeout.
    //
    // We use a longer timeout for relay addresses because naturally they are slower.
    // For local addresses we use a shorter timeout, because we want to go over non-relay addresses reasonably fast.
    const delay = a.includes('p2p-circuit') ? 5000 : 2000
    const [timeout, timer] = newTimeout(delay)

    try {
      onEvent({type: 'dialing', addr: ma.toString()})
      stream = await node.dialProtocol(ma, protocolId, {signal: timeout})
      onEvent({type: 'dial-ok', addr: ma.toString()})
      break
    } catch (e) {
      onEvent({type: 'dial-error', addr: ma.toString(), error: e as Error})
    } finally {
      clearTimeout(timer)
    }
  }

  if (!stream) {
    throw new Error('All dials failed. No stream.')
  }

  try {
    const lp = lpStream(stream)

    // Send the secret token and public key
    await lp.write(new TextEncoder().encode(session.secretToken))
    await lp.write(publicKey)

    // Receive the app's capability
    const msg = await lp.read()
    const appToBrowserCapBlob = msg.subarray()
    const appToBrowserCap = cbor.decode<AgentCapability>(appToBrowserCapBlob)

    // Sign our capability and send it back
    const browserToAppCap = await signAgentCapability(
      keyPair,
      appToBrowserCap.signer,
      BigInt(appToBrowserCap.ts) + 1n, // Increment the timestamp
    )
    const browserToAppCapBlob = cbor.encode(browserToAppCap)
    await lp.write(browserToAppCapBlob)

    // Sign and send the profile alias
    const profileAlias = await signProfileAlias(
      keyPair,
      appToBrowserCap.signer,
      BigInt(appToBrowserCap.ts) + 2n, // Increment the timestamp
    )
    const profileAliasBlob = cbor.encode(profileAlias)
    await lp.write(profileAliasBlob)

    await stream.close()

    // Get account IDs for the completion object
    const browserAccountId = base58btc.encode(publicKey)
    const appAccountId = base58btc.encode(appToBrowserCap.signer)

    return {
      browserAccountId,
      appAccountId,
      profileAlias: {
        data: profileAlias,
        raw: profileAliasBlob,
      },
      browserToAppCap: {
        data: browserToAppCap,
        raw: browserToAppCapBlob,
      },
      appToBrowserCap: {
        data: appToBrowserCap,
        raw: appToBrowserCapBlob,
      },
    }
  } finally {
    await node.stop()
  }
}

function newTimeout(
  msecs: number,
): [AbortSignal, ReturnType<typeof setTimeout>] {
  const abort = new AbortController()
  const id = setTimeout(() => {
    abort.abort()
  }, msecs)
  return [abort.signal, id]
}
