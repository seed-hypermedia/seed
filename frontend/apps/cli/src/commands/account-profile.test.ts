import {afterEach, beforeEach, describe, expect, test} from 'bun:test'
import {createServer, type Server} from 'http'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {CID} from 'multiformats/cid'
import * as superjson from 'superjson'
import * as blobs from '@shm/shared/blobs'
import {deriveKeyPairFromMnemonic} from '../utils/key-derivation'
import {runCli} from '../test/setup'

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const OTHER_MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow'
const VALID_ICON = 'ipfs://bafkreigh2akiscaildcw453np5zsrm6u2i7d7gnitrukz3k5lty63k2fim'
const VALID_CIDV0_ICON = 'ipfs://QmYwAPJzv5CZsnAzt8auVZRnB8qGErgTfDsoKDPCG7bN6F'

type PublishedBlob = {cid?: string; data: Uint8Array}

type MockPublishServer = {
  url: string
  requests: Array<{method: string; url: string; blobs: PublishedBlob[]}>
  close: () => Promise<void>
  failNextPublish: (status: number, body: string) => void
}

async function startMockPublishServer(): Promise<MockPublishServer> {
  const requests: MockPublishServer['requests'] = []
  let nextFailure: {status: number; body: string} | undefined

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/PublishBlobs') {
      res.writeHead(404)
      res.end('not found')
      return
    }

    if (nextFailure) {
      const failure = nextFailure
      nextFailure = undefined
      res.writeHead(failure.status, {'Content-Type': 'text/plain'})
      res.end(failure.body)
      return
    }

    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }

    const payload = cborDecode(Buffer.concat(chunks)) as {blobs: PublishedBlob[]}
    requests.push({method: req.method, url: req.url, blobs: payload.blobs})
    const cids = payload.blobs.map((blob) => blob.cid).filter((cid): cid is string => !!cid)
    res.writeHead(200, {'Content-Type': 'application/json'})
    res.end(JSON.stringify(superjson.serialize({cids})))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('mock server failed to listen')

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    failNextPublish(status: number, body: string) {
      nextFailure = {status, body}
    },
    close: () => closeServer(server),
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

function decodePublishedProfile(published: PublishedBlob): blobs.Encoded<blobs.Profile> {
  expect(published.cid).toBeTruthy()
  return blobs.decodeBlob<blobs.Profile>(published.data, CID.parse(published.cid!))
}

describe('account profile set', () => {
  let server: MockPublishServer
  let keyName: string
  let keyAccountId: string

  beforeEach(async () => {
    server = await startMockPublishServer()
    keyName = `profile_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    keyAccountId = deriveKeyPairFromMnemonic(TEST_MNEMONIC).accountId
    const importResult = await runCli(['key', 'import', '-n', keyName, TEST_MNEMONIC])
    expect(importResult.exitCode).toBe(0)
  })

  afterEach(async () => {
    try {
      await runCli(['key', 'remove', keyName, '--force'])
    } finally {
      await server.close()
    }
  })

  test('publishes a signed self-profile blob and structured JSON output', async () => {
    const result = await runCli(
      [
        '--json',
        'account',
        'profile',
        'set',
        '--name',
        '  Publishing Bot  ',
        '--description',
        '  Automated publisher  ',
        '--icon',
        VALID_ICON,
        '--key',
        keyName,
      ],
      {server: server.url},
    )

    expect(result.exitCode).toBe(0)
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0].blobs).toHaveLength(1)

    const decoded = decodePublishedProfile(server.requests[0].blobs[0])
    expect(blobs.verify(decoded.decoded)).toBe(true)
    expect(decoded.decoded.type).toBe('Profile')
    expect(blobs.principalToString(decoded.decoded.signer)).toBe(keyAccountId)
    expect(decoded.decoded.name).toBe('Publishing Bot')
    expect(decoded.decoded.description).toBe('Automated publisher')
    expect(decoded.decoded.avatar).toBe(VALID_ICON)
    expect(decoded.decoded.account).toBeUndefined()

    const output = JSON.parse(result.stdout)
    expect(output).toEqual({
      cid: decoded.cid.toString(),
      account: keyAccountId,
      profile: {
        name: 'Publishing Bot',
        icon: VALID_ICON,
        description: 'Automated publisher',
      },
    })
  })

  test('publishes delegated profile blob with account field', async () => {
    const targetAccount = deriveKeyPairFromMnemonic(OTHER_MNEMONIC).accountId
    const result = await runCli(
      ['account', 'profile', 'set', '--account', targetAccount, '--name', 'Team Account', '--key', keyName, '--quiet'],
      {server: server.url},
    )

    expect(result.exitCode).toBe(0)
    expect(server.requests).toHaveLength(1)
    const decoded = decodePublishedProfile(server.requests[0].blobs[0])
    expect(decoded.decoded.name).toBe('Team Account')
    expect(blobs.principalToString(decoded.decoded.signer)).toBe(keyAccountId)
    expect(decoded.decoded.account).toBeDefined()
    expect(blobs.principalToString(decoded.decoded.account!)).toBe(targetAccount)
    expect(result.stdout).toBe(decoded.cid.toString())
  })

  test('accepts --avatar as an alias for --icon', async () => {
    const result = await runCli(
      ['account', 'profile', 'set', '--name', 'Avatar Bot', '--avatar', VALID_ICON, '--key', keyName, '-q'],
      {server: server.url},
    )

    expect(result.exitCode).toBe(0)
    expect(server.requests).toHaveLength(1)
    const decoded = decodePublishedProfile(server.requests[0].blobs[0])
    expect(decoded.decoded.avatar).toBe(VALID_ICON)
  })

  test('accepts CIDv0 ipfs:// icons without lowercasing the CID', async () => {
    const result = await runCli(
      ['account', 'profile', 'set', '--name', 'CIDv0 Bot', '--icon', VALID_CIDV0_ICON, '--key', keyName, '-q'],
      {server: server.url},
    )

    expect(result.exitCode).toBe(0)
    expect(server.requests).toHaveLength(1)
    const decoded = decodePublishedProfile(server.requests[0].blobs[0])
    expect(decoded.decoded.avatar).toBe(VALID_CIDV0_ICON)
  })

  test('omits account field when --account explicitly matches the signing key', async () => {
    const result = await runCli(
      [
        'account',
        'profile',
        'set',
        '--account',
        `  ${keyAccountId}  `,
        '--name',
        'Explicit Self',
        '--key',
        keyName,
        '--yaml',
      ],
      {server: server.url},
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('cid:')
    expect(result.stdout).toContain(`account: ${keyAccountId}`)
    expect(server.requests).toHaveLength(1)
    const decoded = decodePublishedProfile(server.requests[0].blobs[0])
    expect(decoded.decoded.name).toBe('Explicit Self')
    expect(decoded.decoded.account).toBeUndefined()
  })

  test('accepts a 511-byte description boundary', async () => {
    const description = 'x'.repeat(511)
    const result = await runCli(
      ['account', 'profile', 'set', '--name', 'Boundary', '--description', description, '--key', keyName, '-q'],
      {server: server.url},
    )

    expect(result.exitCode).toBe(0)
    expect(server.requests).toHaveLength(1)
    const decoded = decodePublishedProfile(server.requests[0].blobs[0])
    expect(decoded.decoded.description).toBe(description)
  })

  test('rejects invalid input before publishing', async () => {
    const cases: string[][] = [
      ['--name', '   ', '--key', keyName],
      ['--name', 'Bad Icon', '--icon', 'https://example.com/avatar.png', '--key', keyName],
      ['--name', 'Bad CID', '--icon', 'ipfs://not-a-cid', '--key', keyName],
      [
        '--name',
        'Both Icons',
        '--icon',
        VALID_ICON,
        '--avatar',
        'ipfs://bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
        '--key',
        keyName,
      ],
      ['--name', 'Long Description', '--description', 'x'.repeat(512), '--key', keyName],
      ['--name', 'Long Multibyte Description', '--description', 'é'.repeat(256), '--key', keyName],
      ['--name', 'Bad Account', '--account', 'not-an-account', '--key', keyName],
      ['--name', 'Missing Key', '--key', `${keyName}_missing`],
    ]

    for (const args of cases) {
      const result = await runCli(['account', 'profile', 'set', ...args], {server: server.url})
      expect(result.exitCode).not.toBe(0)
    }
    expect(server.requests).toHaveLength(0)
  })

  test('surfaces publish failures without claiming success', async () => {
    server.failNextPublish(500, 'boom')
    const result = await runCli(['account', 'profile', 'set', '--name', 'Publish Failure', '--key', keyName], {
      server: server.url,
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('HTTP 500 from PublishBlobs')
    expect(result.stdout).not.toContain('Profile published')
    expect(server.requests).toHaveLength(0)
  })
})
