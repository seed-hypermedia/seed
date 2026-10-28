import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {HMDocumentSchema} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {UniversalAppProvider, type UniversalClient} from '@shm/shared/routing'
import {NavContextProvider, type NavState} from '@shm/shared/utils/navigation'
import {writeableStateStream} from '@shm/shared/utils/stream'
import {ReadOnlyViewerProvider} from '@shm/shared/readonly-viewer-context'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {useState, type ReactNode} from 'react'
import {TooltipProvider} from './tooltip'

/** Stable local identity used by isolated page stories. */
export const storyId = hmId('z6MkfzKMhF9k1oPaQsShWAg8xJzbWf5kaZgn1MkeZvhcAsmB', {path: ['notes']})
/** Pure paragraph content for embeds and connection previews. */
export const storyBlocks: HMBlockNode[] = [
  {
    block: {
      id: 'paragraph',
      type: 'Paragraph',
      text: 'A shared space for project notes.',
      annotations: [],
      attributes: {},
    },
    children: [],
  },
]
/** Complete document fixture without external files or services. */
export const storyDocument = HMDocumentSchema.parse({
  account: storyId.uid,
  path: '/notes',
  authors: [],
  genesis: 'fixture',
  version: 'fixture',
  visibility: 'PUBLIC',
  metadata: {name: 'Project notes'},
  content: storyBlocks,
})
/** Local request responses; unexpected requests fail rather than reaching a service. */
export const storyClient: UniversalClient = {
  request: (async (method: string) => {
    if (method === 'ListCitations') return {citations: []}
    if (method === 'Resource') return {type: 'document', id: storyId, document: storyDocument}
    if (method === 'ListContacts') return {contacts: []}
    throw new Error(`No story fixture for ${method}`)
  }) as UniversalClient['request'],
  publish: async () => {
    throw new Error('Publishing is disabled in Storybook')
  },
}
/** Minimal application contexts with a fresh query cache for each story. */
export function StoryProviders({children, client = storyClient}: {children: ReactNode; client?: UniversalClient}) {
  const [queries] = useState(
    () =>
      new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity, refetchOnWindowFocus: false}}}),
  )
  const [state] = useState(
    () =>
      writeableStateStream<NavState>({routes: [{key: 'document', id: storyId}], routeIndex: 0, lastAction: 'push'})[1],
  )
  return (
    <QueryClientProvider client={queries}>
      <UniversalAppProvider universalClient={client} openUrl={() => {}} openRoute={() => {}} contacts={[]}>
        <NavContextProvider value={{state, dispatch: () => {}}}>
          <TooltipProvider>
            <ReadOnlyViewerProvider
              value={({blocks}) => (
                <div>
                  {blocks.map(({block}) => (
                    <p key={block.id}>{'text' in block ? block.text : block.type}</p>
                  ))}
                </div>
              )}
            >
              {children}
            </ReadOnlyViewerProvider>
          </TooltipProvider>
        </NavContextProvider>
      </UniversalAppProvider>
    </QueryClientProvider>
  )
}
