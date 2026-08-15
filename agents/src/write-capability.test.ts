import {describe, expect, test} from 'bun:test'
import {decode as cborDecode} from '@ipld/dag-cbor'
import * as blobs from '@shm/shared/blobs'
import {writeCapabilityCreate} from '@/api-service'

/**
 * Regression tests for `write {action: "capability.grant"}`.
 *
 * The incident: an agent asked to add a writer to a space root sent `path: "/"`, the dry run
 * reported success, and the real publish came back `500 … path must not end with a slash: /`
 * (backend/blob/index.go rejects it — root scope is the EMPTY path). Two failures in one: the
 * path was forwarded verbatim, and the rehearsal that exists to catch exactly this passed.
 */

function fakeSigner() {
  const keyPair = blobs.generateNobleKeyPair()
  const publicKey = blobs.principalToString(keyPair.principal)
  return {
    secretName: 'writer-key',
    profileName: 'Test Space',
    publicKey,
    keyPair,
    signer: {
      getPublicKey: async () => keyPair.principal,
      sign: (data: Uint8Array) => keyPair.sign(data),
    },
  }
}

/** A client that records what would be published instead of talking to a server. */
function fakeClient() {
  const published: Array<Record<string, unknown>> = []
  return {
    published,
    publish: async (input: {blobs: Array<{data: Uint8Array}>}) => {
      for (const blob of input.blobs) published.push(cborDecode(blob.data) as Record<string, unknown>)
      return {cids: published.map((_, index) => `bafyfake${index}`)}
    },
  }
}

function request(input: Record<string, unknown>, dryRun = false) {
  return {command: 'capability.grant', server: undefined, dev: undefined, dryRun, input}
}

const DELEGATE = blobs.principalToString(blobs.generateNobleKeyPair().principal)

describe('capability.grant', () => {
  test('a "/" path grants the space root instead of failing at the backend', async () => {
    const client = fakeClient()
    const result = await writeCapabilityCreate(
      client as never,
      fakeSigner() as never,
      request({delegate: DELEGATE, role: 'WRITER', path: '/'}),
    )

    expect(result.path).toBeUndefined()
    expect(client.published).toHaveLength(1)
    const capability = client.published[0]!
    expect(capability.type).toBe('Capability')
    expect(capability.role).toBe('WRITER')
    // Root scope is an omitted path — the field the backend turns into `hm://<account>`.
    expect('path' in capability).toBe(false)
  })

  test('nested paths keep their scope, normalized to a leading slash and no trailing slash', async () => {
    for (const [given, expected] of [
      ['/docs', '/docs'],
      ['docs', '/docs'],
      ['/docs/', '/docs'],
      ['/docs/team/', '/docs/team'],
    ] as const) {
      const client = fakeClient()
      const result = await writeCapabilityCreate(
        client as never,
        fakeSigner() as never,
        request({delegate: DELEGATE, role: 'WRITER', path: given}),
      )
      expect(result.path).toBe(expected)
      expect(client.published[0]!.path).toBe(expected)
    }
  })

  test('a dry run fails everything the real publish would fail, and publishes nothing', async () => {
    const client = fakeClient()

    // The regression: this used to return "capability.grant completed" before any validation.
    await expect(
      writeCapabilityCreate(
        client as never,
        fakeSigner() as never,
        request({delegate: 'not-a-principal', role: 'WRITER'}, true),
      ),
    ).rejects.toThrow('Capability delegate is not a valid account ID')
    await expect(
      writeCapabilityCreate(
        client as never,
        fakeSigner() as never,
        request({delegate: DELEGATE, role: 'READER'}, true),
      ),
    ).rejects.toThrow('Capability role must be WRITER or AGENT')

    const rehearsed = await writeCapabilityCreate(
      client as never,
      fakeSigner() as never,
      request({delegate: DELEGATE, role: 'AGENT', path: '/'}, true),
    )
    expect(rehearsed.dryRun).toBe(true)
    expect(rehearsed.path).toBeUndefined()
    expect(client.published).toHaveLength(0)
  })

  test('a delegate that is base58 but not an Ed25519 principal is refused, not granted', async () => {
    const client = fakeClient()
    await expect(
      writeCapabilityCreate(client as never, fakeSigner() as never, request({delegate: 'z6Mk', role: 'WRITER'})),
    ).rejects.toThrow('Capability delegate is not a valid account ID')
    expect(client.published).toHaveLength(0)
  })
})
