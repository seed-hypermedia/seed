import {useAppContext} from '@/app-context'
import {useSelectedAccountContacts} from '@/models/contacts'
import {useExperiments} from '@/models/experiments'
import {useOpenUrl} from '@/open-url'
import {trpc} from '@/trpc'
import {useNavigate} from '@/utils/useNavigate'
import {
  BlockRange,
  ExpandedBlockRange,
  HMEntityContent,
  HMQueryResult,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useUniversalAppContext} from '@shm/shared/routing'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {BlocksContentProvider} from '@shm/ui/blocks-content'
import {
  contentLayoutUnit,
  contentTextUnit,
} from '@shm/ui/blocks-content-constants'
import {useState} from 'react'
import {useDocumentUrl} from '../components/copy-reference-button'

export function AppBlocksContentProvider({
  children,
  docId,
  isBlockFocused = false,
  ...overrides
}: React.PropsWithChildren<Partial<AppBlocksContentContextValue>> & {
  docId?: UnpackedHypermediaId
  isBlockFocused?: boolean
}) {
  const {saveCidAsFile} = useAppContext()
  const openUrl = useOpenUrl()
  const reference = useDocumentUrl({docId, isBlockFocused})
  const replace = useNavigate('replace')
  const route = useNavRoute()
  const experiments = useExperiments()
  const contacts = useSelectedAccountContacts()
  const universalContext = useUniversalAppContext()
  const [collapsedBlocks, setCollapsedBlocksState] = useState<Set<string>>(
    new Set(),
  )
  const setCollapsedBlocks = (id: string, val: boolean) => {
    setCollapsedBlocksState((prev) => {
      const next = new Set(prev)
      if (val) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }
  return (
    <>
      <BlocksContentProvider
        showDevMenu={experiments.data?.pubContentDevMenu}
        layoutUnit={overrides.layoutUnit || contentLayoutUnit}
        textUnit={overrides.textUnit || contentTextUnit}
        debug={false}
        contacts={contacts.data}
        collapsedBlocks={collapsedBlocks}
        setCollapsedBlocks={setCollapsedBlocks}
        onBlockSelect={
          reference
            ? (blockId: string, blockRange) => {
                const shouldCopy = blockRange?.copyToClipboard !== false
                if (blockId && reference && shouldCopy) {
                  reference.onCopy(blockId, blockRange || {expanded: true})
                }
                if (
                  route.key === 'document' &&
                  blockRange?.copyToClipboard !== true
                ) {
                  const element = window.document.getElementById(blockId)
                  if (element) {
                    element.scrollIntoView({behavior: 'smooth', block: 'start'})
                  }

                  replace({
                    ...route,
                    id: {
                      ...route.id,
                      blockRef: blockId,
                      blockRange:
                        blockRange &&
                        'start' in blockRange &&
                        'end' in blockRange
                          ? {start: blockRange.start, end: blockRange.end}
                          : null,
                    },
                  })
                }
              }
            : null
        }
        saveCidAsFile={saveCidAsFile}
        selection={{
          // @ts-expect-error
          uid: route.id?.uid || undefined,
          // @ts-expect-error
          version: route.id?.version || undefined,
          // @ts-expect-error
          blockRef: route.id?.blockRef || undefined,
          // @ts-expect-error
          blockRange: route.id?.blockRange || undefined,
        }}
        onHoverIn={(id) => {
          // @ts-ignore - ipc access
          window.ipc?.broadcast({
            key: 'hypermediaHoverIn',
            id,
          })
        }}
        onHoverOut={(id) => {
          // @ts-ignore - ipc access
          window.ipc?.broadcast({
            key: 'hypermediaHoverOut',
            id,
          })
        }}
        {...overrides}
      >
        {children}
      </BlocksContentProvider>
      {reference?.content}
    </>
  )
}

export type AppBlocksContentContextValue = {
  entityId: UnpackedHypermediaId | undefined
  saveCidAsFile?: (cid: string, name: string) => Promise<void>
  blockCitations?: Record<
    string,
    {
      citations: number
      comments: number
    }
  >
  onBlockCitationClick?: (blockId?: string | null) => void
  onBlockSelect:
    | null
    | ((blockId: string, blockRange?: BlockRange | ExpandedBlockRange) => void)
  onBlockCommentClick?:
    | null
    | ((blockId: string, blockRange?: BlockRange | ExpandedBlockRange) => void)
  layoutUnit: number
  textUnit: number
  debug: boolean
  ffSerif?: boolean
  selection?: {
    uid?: string
    version?: string
    blockRef?: string
    blockRange?: BlockRange
  }
  supportDocuments?: HMEntityContent[]
  supportQueries?: HMQueryResult[]
  onHoverIn?: (id: UnpackedHypermediaId) => void
  onHoverOut?: (id: UnpackedHypermediaId) => void
  commentStyle?: boolean
}
