import '@/blocknote/core/style.css'
import '@/editor.css'
import {HMFormattingToolbar} from '@shm/editor/hm-formatting-toolbar'
import {HypermediaLinkPreview} from '@shm/editor/hm-link-preview'
import {
  SearchResultItem,
  UniversalAppProvider,
  writeableStateStream,
} from '@shm/shared'
import {TooltipProvider} from '@shm/ui/tooltip'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {useEffect, useState} from 'react'
import {
  BlockNoteView,
  FormattingToolbarPositioner,
  HyperlinkToolbarPositioner,
  SlashMenuPositioner,
  useBlockNote,
} from '../../src/blocknote'
import type {Block} from '../../src/blocknote/core/extensions/Blocks/api/blockTypes'
import type {HMBlockSchema} from '../../src/schema'
import {hmBlockSchema} from '../../src/schema'
import {getSlashMenuItems} from '../../src/slash-menu-items'

// Create a dummy gateway URL stream for testing
const [, gwUrl] = writeableStateStream<string | null>('https://hyper.media')

// Mock hypermedia document for document search tests
const mockHmDoc: SearchResultItem = {
  type: 'document',
  title: 'Test HM Doc',
  icon: '',
  parentNames: ['Root', 'Notes'],
  searchQuery: 'test',
  id: {
    id: 'hm://seed.test/doc/test-hm-doc',
    uid: 'bafy-doc-uid',
    path: ['Root', 'Notes', 'Test HM Doc'],
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: 'seed.test',
    scheme: 'hm',
    latest: true,
  },
}

// Mock query client for document search tests
const mockQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: Infinity,
    },
  },
})

// Mock universal context client for document search tests
const mockUniversalClient = {
  request: async (method: string, params: any) => {
    if (method === 'Search') {
      return {entities: [mockHmDoc]}
    }
    throw new Error(`mockUniversalClient: unsupported method ${method}`)
  },
}

// Editor initial content fixtures for link tests
type FixtureName = 'empty' | 'withExternalLink' | 'withHmLink'

const text = (text: string) =>
  ({
    type: 'text',
    text,
    styles: {},
  }) as any

const link = (href: string, label: string) =>
  ({
    type: 'link',
    href,
    content: [text(label)],
  }) as any

const p = (id: string, content: any[]) =>
  ({
    id,
    type: 'paragraph',
    props: {},
    content,
    children: [],
  }) satisfies Block<HMBlockSchema> as any

const fixtures: Record<FixtureName, Block<HMBlockSchema>[]> = {
  empty: [p('p-empty', [])],

  withExternalLink: [
    p('p-ext', [text('Hello '), link('https://example.com', 'Link')]),
  ],

  withHmLink: [
    p('p-hm', [
      text('Hello '),
      link('hm://bafy-doc-uid/Root/Notes/Test HM Doc?l', 'Link'),
    ]),
  ],
}

function getFixtureFromUrl(): FixtureName {
  const sp = new URLSearchParams(window.location.search)
  const name = sp.get('fixture') as FixtureName | null
  return name && name in fixtures ? name : 'empty'
}

// Expose editor state for test assertions
declare global {
  interface Window {
    TEST_EDITOR: {
      editor: ReturnType<typeof useBlockNote<HMBlockSchema>> | null
      getBlocks: () => Block<HMBlockSchema>[]
      getSelection: () => ReturnType<
        ReturnType<typeof useBlockNote<HMBlockSchema>>['getSelection']
      >
      getSelectedText: () => string
      isEditable: () => boolean
      focus: () => void
    }
  }
}

export function TestEditor() {
  const fixtureName = getFixtureFromUrl()

  const [editorContent, setEditorContent] = useState<Block<HMBlockSchema>[]>([])

  const editor = useBlockNote<HMBlockSchema>({
    blockSchema: hmBlockSchema,
    getSlashMenuItems: getSlashMenuItems,
    onEditorContentChange: (e) => {
      setEditorContent(e.topLevelBlocks)
    },
    // Link extension options required for paste handler
    linkExtensionOptions: {
      gwUrl,
    } as any,
    // @ts-expect-error
    initialContent: fixtures[fixtureName],
  })

  // Expose editor instance globally for tests
  useEffect(() => {
    window.TEST_EDITOR = {
      editor,
      getBlocks: () => editor.topLevelBlocks,
      getSelection: () => editor.getSelection(),
      getSelectedText: () => editor.getSelectedText(),
      isEditable: () => editor.isEditable,
      focus: () => editor.focus(),
    }

    return () => {
      // @ts-expect-error - cleanup
      window.TEST_EDITOR = null
    }
  }, [editor])

  return (
    <TooltipProvider>
      <QueryClientProvider client={mockQueryClient}>
        <UniversalAppProvider
          universalClient={mockUniversalClient as any}
          openUrl={(url?: string, newWindow?: boolean) => {
            console.log('openUrl', {url, newWindow})
          }}
          openRoute={(...args: any[]) => {
            console.log('openRoute', args)
          }}
        >
          <div className="test-harness" data-testid="editor-harness">
            <div className="test-info" data-testid="editor-info">
              <strong>Block count:</strong> {editorContent.length} |{' '}
              <strong>Editor ready:</strong> {editor.ready ? 'Yes' : 'No'}
            </div>
            <div data-testid="editor-container">
              <BlockNoteView editor={editor} theme="light">
                <SlashMenuPositioner editor={editor} />
                <FormattingToolbarPositioner
                  editor={editor}
                  formattingToolbar={HMFormattingToolbar}
                />
                <HyperlinkToolbarPositioner
                  editor={editor}
                  openUrl={() => {}}
                  // @ts-expect-error
                  hyperlinkToolbar={HypermediaLinkPreview}
                />
              </BlockNoteView>
            </div>
          </div>
        </UniversalAppProvider>
      </QueryClientProvider>
    </TooltipProvider>
  )
}
