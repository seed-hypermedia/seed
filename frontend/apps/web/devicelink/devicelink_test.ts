import {createLibp2p} from 'libp2p'
import {webRTC, webRTCDirect} from '@libp2p/webrtc'
import {circuitRelayTransport} from '@libp2p/circuit-relay-v2'
import {Ping, ping} from '@libp2p/ping'
import {multiaddr} from '@multiformats/multiaddr'
import {Identify, identify} from '@libp2p/identify'
import {peerIdFromString} from '@libp2p/peer-id'
import {yamux} from '@libp2p/yamux'
import {createGRPCClient} from '@shm/shared'
import {createGrpcWebTransport} from '@connectrpc/connect-web'
import {lpStream} from 'it-length-prefixed-stream'
import * as cbor from '@ipld/dag-cbor'

const tr = createGrpcWebTransport({
  baseUrl: 'http://localhost:58001',
})

const client = createGRPCClient(tr)

// This key pair represents the web identity.
// Presumably exists already in the browser.
const accountKeyPair = await crypto.subtle.generateKey(
  {
    name: 'ECDSA',
    namedCurve: 'P-256',
  },
  false,
  ['sign', 'verify'],
)

const protocolId = '/hypermedia/devicelink/0.1.0'

export async function main() {
  const keys = await client.daemon.listKeys({})
  keys.keys.sort((a, b) => a.name.localeCompare(b.name))

  const key = keys.keys[0]

  const session = await client.daemon.createDeviceLinkSession({
    // @ts-expect-error
    signingKeyName: key.name,
  })

  // Replace with peer info of your locally running Kubo node.
  const peerInfo = {
    id: session.addrInfo!.peerId!,
    addrs: session.addrInfo!.addrs,
  }

  const node = await createLibp2p({
    transports: [webRTCDirect(), webRTC(), circuitRelayTransport()],
    services: {
      ping: ping(),
      identify: identify(),
    },
    streamMuxers: [yamux()],
  })

  const pid = peerIdFromString(peerInfo.id)

  await node.peerStore.merge(pid, {
    multiaddrs: peerInfo.addrs.map((v) => multiaddr(v)),
  })

  const pubKey = await preparePublicKey(accountKeyPair.publicKey)

  try {
    const stream = await node.dialProtocol(pid, protocolId)

    const lp = lpStream(stream)

    await lp.write(new TextEncoder().encode(session.secretToken))
    await lp.write(pubKey)
    const msg = await lp.read()

    const appToBrowserCap = cbor.decode<AgentCapability>(msg.subarray())
    // TODO: Validate the capability and verify the signature.

    const browserToAppCap = await signAgentCapability(
      accountKeyPair,
      appToBrowserCap.signer,
      BigInt(appToBrowserCap.ts) + 1n, // Increment the timestamp.
    )

    await lp.write(cbor.encode(browserToAppCap))

    const profileAlias = await signProfileAlias(
      accountKeyPair,
      appToBrowserCap.signer,
      BigInt(appToBrowserCap.ts) + 2n, // Increment the timestamp.
    )

    await lp.write(cbor.encode(profileAlias))

    console.log(appToBrowserCap)
    console.log(browserToAppCap)
    console.log(profileAlias)

    await stream.close()
  } finally {
    await node.stop()
  }

  // In the browser refresh the page.
  // Until this PR is released: https://github.com/libp2p/js-libp2p/pull/3076.
  process.exit(0)
}

main()

async function preparePublicKey(publicKey: CryptoKey): Promise<PublicKey> {
  if (publicKey.algorithm.name !== 'ECDSA') {
    throw new Error('Invalid key type: only ECDSA keys are supported')
  }

  // Export raw key first
  const raw = await crypto.subtle.exportKey('raw', publicKey)
  const bytes = new Uint8Array(raw)

  // Raw format is 65 bytes: 0x04 + x (32) + y (32)
  const x = bytes.slice(1, 33)
  const y = bytes.slice(33)

  // Check if y is odd
  // @ts-expect-error
  const prefix = y[31] & 1 ? 0x03 : 0x02

  const outputKeyValue = new Uint8Array([
    // varint prefix for 0x1200
    128,
    36,
    prefix,
    ...x,
  ])
  return outputKeyValue
}

type PublicKey = Uint8Array

type AgentCapability = {
  type: 'Capability'
  role: 'AGENT'
  delegate: PublicKey
  signer: PublicKey
  sig: Uint8Array
  ts: bigint
}

async function signAgentCapability(
  kp: CryptoKeyPair,
  delegate: PublicKey,
  ts: bigint,
): Promise<AgentCapability> {
  const pubKey = await preparePublicKey(kp.publicKey)

  const unsigned: AgentCapability = {
    type: 'Capability',
    role: 'AGENT',
    delegate,
    ts,
    signer: pubKey,
    sig: new Uint8Array(64),
  }

  const unsignedData = cbor.encode(unsigned)
  const sig = await crypto.subtle.sign(
    {
      ...kp.privateKey.algorithm,
      hash: {name: 'SHA-256'},
    },
    kp.privateKey,
    unsignedData,
  )

  return {
    ...unsigned,
    sig: new Uint8Array(sig),
  }
}

type Profile = {
  type: 'Profile'
  alias: PublicKey
  signer: PublicKey
  sig: Uint8Array
  ts: bigint
}

async function signProfileAlias(
  kp: CryptoKeyPair,
  alias: PublicKey,
  ts: bigint,
): Promise<Profile> {
  const pubKey = await preparePublicKey(kp.publicKey)

  const unsigned: Profile = {
    type: 'Profile',
    alias,
    ts,
    signer: pubKey,
    sig: new Uint8Array(64),
  }

  const unsignedData = cbor.encode(unsigned)
  const sig = await crypto.subtle.sign(
    {
      ...kp.privateKey.algorithm,
      hash: {name: 'SHA-256'},
    },
    kp.privateKey,
    unsignedData,
  )

  return {
    ...unsigned,
    sig: new Uint8Array(sig),
  }
}
