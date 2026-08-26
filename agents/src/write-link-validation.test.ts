import {describe, expect, test} from 'bun:test'
import {assertHmContentLinks, collectHmContentLinks} from '@/api-service'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'

/** A paragraph whose text carries one link annotation. */
function linkedParagraph(link: string, type: 'Link' | 'Embed' = 'Link'): HMBlockNode {
  return {
    block: {
      id: crypto.randomUUID(),
      type: 'Paragraph',
      text: 'see the target',
      attributes: {},
      annotations: [{type, starts: [0], ends: [3], link}],
    },
    children: [],
  } as unknown as HMBlockNode
}

function embedBlock(link: string): HMBlockNode {
  return {
    block: {id: crypto.randomUUID(), type: 'Embed', link, attributes: {}, annotations: []},
    children: [],
  } as unknown as HMBlockNode
}

const GOOD = 'hm://z6MkpFjnYQfWrMVoDsBoHwzXvvRMGjKRNTsezab9x8CpGr63/notes'
const GOOD2 = 'hm://z6MkpFjnYQfWrMVoDsBoHwzXvvRMGjKRNTsezab9x8CpGr63/other'

/** A client whose Resource answers come from a script; records what was asked. */
function fakeClient(answer: (link: string) => 'found' | 'not-found' | 'throw') {
  const asked: string[] = []
  return {
    asked,
    request: async (key: string, id: unknown) => {
      if (key !== 'Resource') throw new Error(`unexpected request ${key}`)
      const uid = (id as {uid: string; path?: string[] | null}).uid
      const path = ((id as {path?: string[] | null}).path ?? []).join('/')
      const link = `hm://${uid}${path ? `/${path}` : ''}`
      asked.push(link)
      const verdict = answer(link)
      if (verdict === 'throw') throw new Error('server unreachable')
      if (verdict === 'not-found') return {type: 'not-found', id}
      return {type: 'document', id, document: {}}
    },
  }
}

describe('collectHmContentLinks', () => {
  test('finds annotation links, embed-block links, and nested children; ignores web links', () => {
    const nodes: HMBlockNode[] = [
      linkedParagraph(GOOD),
      {
        block: {
          id: 'p2',
          type: 'Paragraph',
          text: 'web',
          attributes: {},
          annotations: [{type: 'Link', starts: [0], ends: [3], link: 'https://example.com'}],
        },
        children: [embedBlock(GOOD2)],
      } as unknown as HMBlockNode,
    ]
    expect(collectHmContentLinks(nodes)).toEqual([GOOD, GOOD2])
  })
})

describe('assertHmContentLinks', () => {
  test('a malformed hm link fails the write and names the link, without any server call', async () => {
    const client = fakeClient(() => 'found')
    await expect(assertHmContentLinks(client, [linkedParagraph('hm://not a valid id!!')])).rejects.toThrow(
      /malformed hm:\/\/ links.*hm:\/\/not a valid id!!/s,
    )
    expect(client.asked).toEqual([])
  })

  test('a link whose target does not exist fails the write with recovery guidance', async () => {
    const client = fakeClient((link) => (link === GOOD ? 'found' : 'not-found'))
    await expect(assertHmContentLinks(client, [linkedParagraph(GOOD), embedBlock(GOOD2)])).rejects.toThrow(
      /do not exist.*other.*skipLinkCheck/s,
    )
  })

  test('resolvable links pass, deduped', async () => {
    const client = fakeClient(() => 'found')
    await assertHmContentLinks(client, [linkedParagraph(GOOD), linkedParagraph(GOOD), embedBlock(GOOD2)])
    expect(client.asked.sort()).toEqual([GOOD, GOOD2].sort())
  })

  test('an unreachable HM server never blocks publishing', async () => {
    // Infra flake must not hold content hostage: only a definitive not-found is a broken link.
    const client = fakeClient(() => 'throw')
    await assertHmContentLinks(client, [linkedParagraph(GOOD)])
  })

  test('skipResolve skips resolution but never skips malformed-ness', async () => {
    const client = fakeClient(() => 'not-found')
    await assertHmContentLinks(client, [linkedParagraph(GOOD)], {skipResolve: true})
    expect(client.asked).toEqual([])
    await expect(
      assertHmContentLinks(client, [linkedParagraph('hm://broken link')], {skipResolve: true}),
    ).rejects.toThrow(/malformed/)
  })
})
