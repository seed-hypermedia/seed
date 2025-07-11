import {useAppContext} from '@/app-context'
import {
  EmbedDocument,
  EmbedInline,
  QueryBlockDesktop,
} from '@/components/app-embeds'
import {useExperiments} from '@/models/experiments'
import {useOpenUrl} from '@/open-url'
import {trpc} from '@/trpc'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {PlainMessage} from '@bufbuild/protobuf'
import {Contact} from '@shm/shared'
import {EntityComponentsRecord} from '@shm/shared/document-content-types'
import {
  BlockRange,
  ExpandedBlockRange,
  HMEntityContent,
  HMQueryResult,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {DocContentProvider} from '@shm/ui/document-content'
import {
  contentLayoutUnit,
  contentTextUnit,
} from '@shm/ui/document-content-constants'
import {useDocumentUrl} from '../components/copy-reference-button'

export function AppDocContentProvider({
  children,
  docId,
  isBlockFocused = false,
  contacts,
  ...overrides
}: React.PropsWithChildren<Partial<DocContentContextValue>> & {
  docId?: UnpackedHypermediaId
  isBlockFocused?: boolean
  contacts?: PlainMessage<Contact>[]
}) {
  const {saveCidAsFile} = useAppContext()
  const openUrl = useOpenUrl()
  const reference = useDocumentUrl({docId, isBlockFocused})
  const replace = useNavigate('replace')
  const route = useNavRoute()
  const experiments = useExperiments()
  const importWebFile = trpc.webImporting.importWebFile.useMutation()
  return (
    <>
      <DocContentProvider
        showDevMenu={experiments.data?.pubContentDevMenu}
        layoutUnit={contentLayoutUnit}
        importWebFile={importWebFile}
        textUnit={contentTextUnit}
        entityId={docId}
        debug={false}
        contacts={contacts}
        entityComponents={{
          Document: EmbedDocument,
          Inline: EmbedInline,
          Query: QueryBlockDesktop,
        }}
        onBlockCopy={
          reference
            ? (
                blockId: string,
                blockRange: BlockRange | ExpandedBlockRange | undefined,
              ) => {
                if (blockId && reference) {
                  reference.onCopy(blockId, blockRange || {expanded: true})
                }
                if (route.key === 'document') {
                  replace({
                    ...route,
                    id: {
                      ...route.id,
                      blockRef: blockId,
                      blockRange:
                        blockRange &&
                        'start' in blockRange &&
                        'end' in blockRange
                          ? blockRange
                          : null,
                    },
                  })
                }
              }
            : null
        }
        openUrl={openUrl}
        saveCidAsFile={saveCidAsFile}
        routeParams={{
          uid: route.id?.uid || undefined,
          version: route.id?.version || undefined,
          blockRef: route.id?.blockRef || undefined,
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
      </DocContentProvider>
      {reference?.content}
    </>
  )
}

export type DocContentContextValue = {
  entityId: UnpackedHypermediaId | undefined
  entityComponents: EntityComponentsRecord
  saveCidAsFile?: (cid: string, name: string) => Promise<void>
  blockCitations?: Record<
    string,
    {
      citations: number
      comments: number
    }
  >
  onBlockCitationClick?: (blockId?: string | null) => void
  onBlockCopy:
    | null
    | ((blockId: string, blockRange?: BlockRange | ExpandedBlockRange) => void)
  onBlockReply?: null | ((blockId: string) => void)
  onBlockCommentClick?:
    | null
    | ((blockId: string, blockRange?: BlockRange | ExpandedBlockRange) => void)
  layoutUnit: number
  textUnit: number
  debug: boolean
  ffSerif?: boolean
  comment?: boolean
  routeParams?: {
    uid?: string
    version?: string
    blockRef?: string
    blockRange?: BlockRange
  }
  importWebFile?: any
  handleFileAttachment?: (
    file: File,
  ) => Promise<{displaySrc: string; fileBinary: Uint8Array}>
  openUrl?: (url?: string, newWindow?: boolean) => void
  supportDocuments?: HMEntityContent[]
  supportQueries?: HMQueryResult[]
  onHoverIn?: (id: UnpackedHypermediaId) => void
  onHoverOut?: (id: UnpackedHypermediaId) => void
}
