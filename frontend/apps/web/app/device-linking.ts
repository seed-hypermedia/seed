import {yamux} from '@chainsafe/libp2p-yamux'
import * as cbor from '@ipld/dag-cbor'
import {circuitRelayTransport} from '@libp2p/circuit-relay-v2'
import {identify} from '@libp2p/identify'
import {ping} from '@libp2p/ping'
import {webRTC, webRTCDirect} from '@libp2p/webrtc'
import {multiaddr} from '@multiformats/multiaddr'
import {DeviceLinkSession} from '@shm/shared/hm-types'
import {lpStream} from 'it-length-prefixed-stream'
import {createLibp2p} from 'libp2p'
import {base58btc} from 'multiformats/bases/base58'

import {
  AgentCapability,
  generateAndStoreKeyPair,
  signAgentCapability,
  signProfileAlias,
} from './auth'
import {preparePublicKey} from './auth-utils'
import {getStoredLocalKeys} from './local-db'
import {Stream} from '@libp2p/interface'

export type DeviceLinkCompletion = {
  browserAccountId: string
  appAccountId: string
}

export async function linkDevice(
  session: DeviceLinkSession,
): Promise<DeviceLinkCompletion> {
  let keyPair = await getStoredLocalKeys()
  if (!keyPair) {
    keyPair = await generateAndStoreKeyPair()
  }
  const publicKey = await preparePublicKey(keyPair.publicKey)
  console.log('Will link device', session)
  console.log('Public key for session:', publicKey)

  const protocolId = '/hypermedia/devicelink/0.1.0'

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

  console.log('node =', node)

  const addrs = session.addrInfo.addrs
    // We can only dial webrtc-direct addresses, so we filter out the rest.
    .filter((a) => a.includes('webrtc-direct'))
    // For simplicity we prioritize localhost addresses first,
    // because this is our common use case.
    // The other addresses are still available for dialing.
    .sort((a, b) => {
      if (a.includes('127.0.0.1') && !b.includes('127.0.0.1')) {
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
    try {
      stream = await node.dialProtocol(ma, protocolId)
      break
    } catch (e) {
      console.error('Failed to dial multiaddr', ma.toString(), e)
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
    const appToBrowserCap = cbor.decode<AgentCapability>(msg.subarray())

    // Sign our capability and send it back
    const browserToAppCap = await signAgentCapability(
      keyPair,
      appToBrowserCap.signer,
      BigInt(appToBrowserCap.ts) + 1n, // Increment the timestamp
    )
    await lp.write(cbor.encode(browserToAppCap))

    // Sign and send the profile alias
    const profileAlias = await signProfileAlias(
      keyPair,
      appToBrowserCap.signer,
      BigInt(appToBrowserCap.ts) + 2n, // Increment the timestamp
    )
    await lp.write(cbor.encode(profileAlias))

    console.log('Device linking successful')
    console.log('App capability:', appToBrowserCap)
    console.log('Browser capability:', browserToAppCap)
    console.log('Profile alias:', profileAlias)

    await stream.close()

    // Get account IDs for the completion object
    const browserAccountId = base58btc.encode(publicKey)
    const appAccountId = base58btc.encode(appToBrowserCap.signer)

    return {
      browserAccountId,
      appAccountId,
    }
  } finally {
    console.log('stopping libp2p node')
    await node.stop()
  }
}
