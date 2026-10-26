import './tailwind.css'
import '../../src/blocknote/core/style.css'
import '../../src/editor.css'
import React from 'react'
import {createRoot} from 'react-dom/client'
import type {HMBlockEmbed, HMBlockNode, HMComment, HMDocument} from '@seed-hypermedia/client/hm-types'
import {hmId, UniversalAppProvider, writeableStateStream} from '@shm/shared'
import {NavContextProvider} from '@shm/shared/utils/navigation'
import {ReadOnlyViewerProvider} from '@shm/shared/readonly-viewer-context'
import {SelectedAccountContactsProvider} from '@shm/shared/models/contacts'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {TooltipProvider} from '@shm/ui/tooltip'
import {BlockEmbedCard, BlockEmbedContent} from '@shm/ui/embed-views'
import {QuotedDocBlock} from '@shm/ui/comments'
import {ReadOnlyViewer} from '../../src/readonly-viewer'

const account = 'bafy-gallery-author'
const name = 'Alexandra Montgomery Field'
const documentId = hmId(account, {path: ['field-notes'], version: 'v1'})
const text = 'A shared source should keep its meaning, formatting, and identity in every place where it appears.'
const blocks: HMBlockNode[] = [
  {
    block: {
      id: 'intro',
      type: 'Paragraph',
      text,
      attributes: {},
      annotations: [
        {type: 'Bold', starts: [2], ends: [15]},
        {type: 'Link', starts: [16], ends: [22], link: 'https://example.com/source'},
      ],
    },
    children: [],
  },
  {
    block: {
      id: 'detail',
      type: 'Paragraph',
      text: 'The second paragraph remains visible when the complete resource is expanded.',
      attributes: {},
      annotations: [],
    },
    children: [],
  },
]
const document: HMDocument = {
  account,
  path: '/field-notes',
  version: 'v1',
  genesis: 'v1',
  authors: [account],
  metadata: {name: 'Notes on shared context'},
  content: blocks,
  visibility: 'PUBLIC',
  createTime: '2026-10-20T12:00:00Z',
  updateTime: '2026-10-20T12:00:00Z',
} as HMDocument
const comment: HMComment = {
  id: `${account}/comment1`,
  version: 'c1',
  author: account,
  targetAccount: account,
  targetPath: '/field-notes',
  targetVersion: 'v1',
  content: blocks,
  createTime: '2026-10-20T12:00:00Z',
  updateTime: '2026-10-20T12:00:00Z',
  visibility: 'PUBLIC',
}
const client = {
  request: async (method: string, params: any) => {
    if (method === 'Account') return {id: hmId(account), metadata: {name}}
    if (method === 'AccountContacts') return []
    if (method === 'Resource') {
      if (params.path?.includes('comment1')) return {type: 'comment', id: params, comment}
      return {
        type: 'document',
        id: params,
        document: params.path?.length ? document : {...document, path: '/', metadata: {name}},
      }
    }
    if (method === 'Interaction' || method === 'InteractionSummary') return {comments: 0, children: 0}
    return null
  },
  publish: async () => ({cids: []}),
}
const [, navState] = writeableStateStream<any>({
  routes: [{key: 'document', id: hmId('bafy-gallery-host')}],
  routeIndex: 0,
  lastAction: 'push',
})
;(window as any).GALLERY_NAVIGATION = []
const queryClient = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}})
const cases = [
  ['Document · full', `hm://${account}/field-notes?v=v1`],
  ['Document · block', `hm://${account}/field-notes?v=v1#intro`],
  ['Document · fragment', `hm://${account}/field-notes?v=v1#intro[2:63]`],
  ['Comment · whole', `hm://${account}/comment1?v=c1`],
  ['Comment · fragment', `hm://${account}/comment1?v=c1#intro[2:63]`],
] as const

/** Real production embeds, with fixed data at the network provider boundary. */
function EmbedGallery() {
  return (
    <TooltipProvider>
      <QueryClientProvider client={queryClient}>
        <NavContextProvider value={{state: navState, dispatch: () => {}} as any}>
          <UniversalAppProvider
            universalClient={client as any}
            openUrl={(url) => (window as any).GALLERY_NAVIGATION.push({url})}
            openRoute={(route) => (window as any).GALLERY_NAVIGATION.push({route})}
            openRouteNewWindow={
              (window as any).GALLERY_WEB_NAVIGATION
                ? undefined
                : (route) => (window as any).GALLERY_NAVIGATION.push({newWindowRoute: route})
            }
            hmUrlHref={!(window as any).GALLERY_WEB_NAVIGATION}
          >
            <SelectedAccountContactsProvider>
              <ReadOnlyViewerProvider value={ReadOnlyViewer}>
                <main style={{maxWidth: 1200, margin: '0 auto', padding: 24}}>
                  <h1 style={{fontSize: 24, fontWeight: 600}}>Embed component review</h1>
                  <p style={{fontSize: 13, marginBottom: 24}}>
                    Production components · fixed fixture data · no live app server
                  </p>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))',
                      gap: 24,
                    }}
                  >
                    {cases.map(([label, link]) => (
                      <section key={label} data-case={label} style={{minWidth: 0}}>
                        <h2 style={{fontSize: 13, fontWeight: 600, marginBottom: 12}}>{label}</h2>
                        <BlockEmbedContent
                          block={{id: label, type: 'Embed', link, attributes: {view: 'Content'}} as HMBlockEmbed}
                          parentBlockId={null}
                        />
                      </section>
                    ))}
                    <section data-case="Reply quote" style={{minWidth: 0}}>
                      <h2 style={{fontSize: 13, fontWeight: 600, marginBottom: 12}}>Reply quote · fragment</h2>
                      <QuotedDocBlock
                        docId={documentId}
                        doc={document}
                        blockId="intro"
                        blockRange={{start: 2, end: 63}}
                      />
                    </section>
                    <section data-case="Account home card" style={{minWidth: 0}}>
                      <h2 style={{fontSize: 13, fontWeight: 600, marginBottom: 12}}>Account home document · card</h2>
                      <BlockEmbedCard
                        block={
                          {
                            id: 'profile-card',
                            type: 'Embed',
                            link: `hm://${account}`,
                            attributes: {view: 'Card'},
                          } as HMBlockEmbed
                        }
                        parentBlockId={null}
                      />
                    </section>
                    <section data-case="Inline profile mention" style={{minWidth: 0}}>
                      <h2 style={{fontSize: 13, fontWeight: 600, marginBottom: 12}}>Inline profile mention</h2>
                      <ReadOnlyViewer
                        blocks={[
                          {
                            block: {
                              id: 'mention',
                              type: 'Paragraph',
                              text: 'Notes by \uFFFC for the review.',
                              attributes: {},
                              annotations: [
                                {
                                  type: 'Embed',
                                  link: `hm://${account}`,
                                  starts: [9],
                                  ends: [10],
                                  attributes: {mentionKind: 'account'},
                                },
                              ],
                            },
                            children: [],
                          },
                        ]}
                      />
                    </section>
                  </div>
                </main>
              </ReadOnlyViewerProvider>
            </SelectedAccountContactsProvider>
          </UniversalAppProvider>
        </NavContextProvider>
      </QueryClientProvider>
    </TooltipProvider>
  )
}

createRoot(window.document.getElementById('root')!).render(<EmbedGallery />)
