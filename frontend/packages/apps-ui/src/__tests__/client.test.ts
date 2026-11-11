import * as blobs from '@shm/shared/blobs'
import * as cbor from '@shm/shared/cbor'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {AgentProtocolError, AgentServerError, createSeedAgentsClient} from '../client'
import type {SeedAgentsSigner} from '../host'

const account = blobs.nobleKeyPairFromSeed(new Uint8Array(32).fill(1))
const device = blobs.nobleKeyPairFromSeed(new Uint8Array(32).fill(2))
const accountUid = blobs.principalToString(account.principal)

function signerFor(key: blobs.NobleKeyPair, extra: Partial<SeedAgentsSigner> = {}): SeedAgentsSigner {
  return {accountUid, sign: (data) => key.sign(data), ...extra}
}

/** Answers every POST with `reply` and records the decoded envelopes. */
function fakeServer(reply: unknown, status = 200) {
  const envelopes: Record<string, any>[] = []
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    expect(String(url)).toBe('http://agents.test/api/message')
    expect(init?.headers).toMatchObject({'Content-Type': 'application/cbor'})
    envelopes.push(cbor.decode(new Uint8Array(init!.body as ArrayBuffer)))
    return new Response(cbor.encode(reply) as BodyInit, {status})
  })
  vi.stubGlobal('fetch', fetchMock)
  return envelopes
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createSeedAgentsClient', () => {
  it('signs as the account and returns the typed response', async () => {
    const envelopes = fakeServer({_: 'CreateSessionResponse', sessionId: 's1'})
    const client = createSeedAgentsClient({serverUrl: 'http://agents.test/', signer: signerFor(account)})
    const response = await client.send({_: 'CreateSession', agentId: 'a1'})
    // Typed: CreateSession answers CreateSessionResponse, which has a sessionId.
    const sessionId: string = response.sessionId
    expect(sessionId).toBe('s1')

    const envelope = envelopes[0]!
    expect(envelope.type).toBe('AgentsAction')
    expect(blobs.principalToString(envelope.account)).toBe(accountUid)
    expect(blobs.principalToString(envelope.signer)).toBe(accountUid)
    expect(envelope.capability).toBeUndefined()
    expect(envelope.action).toMatchObject({_: 'CreateSession', agentId: 'a1'})
    expect(typeof envelope.action.ts).toBe('number')
    expect(blobs.verify(envelope as blobs.Blob)).toBe(true)
  })

  it('names the delegation when another key signs for the account', async () => {
    const envelopes = fakeServer({_: 'StopSessionResponse'})
    const signer = signerFor(device, {
      signerUid: blobs.principalToString(device.principal),
      delegation: {capabilityCid: 'bafycap', capabilityBlob: new Uint8Array([1, 2, 3])},
    })
    await createSeedAgentsClient({serverUrl: 'http://agents.test', signer}).send({_: 'StopSession', sessionId: 's1'})
    const envelope = envelopes[0]!
    expect(blobs.principalToString(envelope.signer)).toBe(signer.signerUid)
    expect(blobs.principalToString(envelope.account)).toBe(accountUid)
    expect(envelope.capability).toBe('bafycap')
    expect(Array.from(envelope.capabilityBlob)).toEqual([1, 2, 3])
    expect(blobs.verify(envelope as blobs.Blob)).toBe(true)
  })

  it('refuses a foreign signer without a delegation', async () => {
    fakeServer({_: 'StopSessionResponse'})
    const signer = signerFor(device, {signerUid: blobs.principalToString(device.principal)})
    await expect(
      createSeedAgentsClient({serverUrl: 'http://agents.test', signer}).send({_: 'StopSession', sessionId: 's1'}),
    ).rejects.toThrow(/no delegation/)
  })

  it('throws server errors as AgentServerError, and retired protocols as AgentProtocolError', async () => {
    fakeServer({_: 'Error', message: 'Session not found'}, 404)
    const client = createSeedAgentsClient({serverUrl: 'http://agents.test', signer: signerFor(account)})
    const error = await client.send({_: 'GetSession', sessionId: 'nope'}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AgentServerError)
    expect(error).toMatchObject({status: 404, message: 'Session not found'})

    fakeServer({_: 'Error', message: 'Update the app', code: 'protocol_too_old'}, 426)
    const old = await client.send({_: 'GetSession', sessionId: 's1'}).catch((e: unknown) => e)
    expect(old).toBeInstanceOf(AgentProtocolError)
    expect(old).toBeInstanceOf(AgentServerError)
  })
})
