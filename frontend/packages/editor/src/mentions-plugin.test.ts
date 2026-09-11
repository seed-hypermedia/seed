import {describe, expect, it} from 'vitest'
import {createInlineEmbedNode, inlineEmbedClipboardText, MentionToken} from './mentions-plugin'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {UniversalAppProvider} from '@shm/shared/routing'
import {queryAccount, queryResource} from '@shm/shared/models/queries'
import {unpackHmId} from '@shm/shared'

describe('inlineEmbedClipboardText', () => {
  it('serializes inline embeds to a non-empty clipboard fallback', () => {
    expect(inlineEmbedClipboardText('hm://uid1/docs/page')).toBe('hm://uid1/docs/page')
  })

  it('returns empty string when link is missing', () => {
    expect(inlineEmbedClipboardText('')).toBe('')
  })

  it('parses data-inline-embed anchors before generic links', () => {
    const parseRules = createInlineEmbedNode().config.parseHTML?.() || []

    expect(parseRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: 'a[data-inline-embed]',
          priority: 1000,
        }),
      ]),
    )
  })
})

it('preserves mention kind in rich clipboard HTML', () => {
  const node = createInlineEmbedNode()
  expect(node.config.addAttributes?.()).toHaveProperty('mentionKind')
  const html = node.config.renderHTML?.({
    node: {attrs: {link: 'hm://alice', mentionKind: 'document'}},
    HTMLAttributes: {link: 'hm://alice'},
  } as any)
  expect(html?.[1]).toHaveProperty('data-mention-kind', 'document')
})

describe('mention labels', () => {
  function renderMention(link: string, mentionKind?: 'account' | 'document', name = 'Alice') {
    const client = {request: async () => null} as any
    const queryClient = new QueryClient({defaultOptions: {queries: {staleTime: Infinity}}})
    queryClient.setQueryData(queryAccount(client, 'alice').queryKey, {metadata: {name}})
    for (const id of [unpackHmId('hm://alice'), unpackHmId('hm://alice/page')]) {
      queryClient.setQueryData(queryResource(client, id).queryKey, {
        type: 'document',
        document: {metadata: {name: 'Home document'}},
      })
    }
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        {client: queryClient},
        createElement(
          UniversalAppProvider,
          {universalClient: client, openUrl: () => {}, openRoute: () => {}},
          createElement(MentionToken, {value: link, mentionKind}),
        ),
      ),
    )
    queryClient.clear()
    return html
  }

  it.each([
    ['hm://alice/:profile', 'account'],
    ['hm://alice/:profile', undefined],
    ['hm://alice', undefined],
  ] as const)('prefixes account label %s (%s) with @', (link, kind) => {
    expect(renderMention(link, kind)).toContain('>@Alice<')
  })

  it('does not duplicate an existing @ in a profile name or petname', () => {
    expect(renderMention('hm://alice/:profile', 'account', '@Alice')).toContain('>@Alice<')
  })

  it.each([
    ['hm://alice', 'document'],
    ['hm://alice/page', 'document'],
    ['hm://alice/page', undefined],
  ] as const)('keeps document label %s (%s) unprefixed', (link, kind) => {
    expect(renderMention(link, kind)).toContain('>Home document<')
    expect(renderMention(link, kind)).not.toContain('@Home document')
  })
})
