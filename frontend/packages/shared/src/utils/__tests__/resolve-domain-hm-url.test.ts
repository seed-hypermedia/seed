import {describe, expect, it, vi} from 'vitest'
import {resolveDomainHmUrl} from '../resolve-domain-hm-url'

const UID = 'z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou'
const client = {request: vi.fn(async () => ({registeredAccountUid: UID, isGateway: true}))}

describe('resolveDomainHmUrl', () => {
  it('swaps a domain for its account and keeps path, view term and query as written', async () => {
    const domainResolver = vi.fn(async () => ({registeredAccountUid: UID, isGateway: true}))
    await expect(
      resolveDomainHmUrl('hm://hyper.media/agent/guide/:settings/prompt?v=abc#intro', {
        domainResolver,
        universalClient: client,
      }),
    ).resolves.toBe(`hm://${UID}/agent/guide/:settings/prompt?v=abc#intro`)
    expect(domainResolver).toHaveBeenCalledWith('hyper.media')
  })

  it('falls back to the client GetDomain when the host has no resolver', async () => {
    client.request.mockClear()
    await expect(resolveDomainHmUrl('hm://hyper.media/agent', {universalClient: client})).resolves.toBe(
      `hm://${UID}/agent`,
    )
    expect(client.request).toHaveBeenCalledWith('GetDomain', {domain: 'hyper.media'})
  })

  it('leaves principal ids and non-hm links alone', () => {
    expect(resolveDomainHmUrl(`hm://${UID}/agent`, {universalClient: client})).toBeNull()
    expect(resolveDomainHmUrl('https://hyper.media/agent', {universalClient: client})).toBeNull()
  })

  it('rejects when the domain names no account', async () => {
    const domainResolver = vi.fn(async () => null)
    await expect(
      resolveDomainHmUrl('hm://nobody.example/x', {domainResolver, universalClient: client}),
    ).rejects.toThrow()
  })
})
