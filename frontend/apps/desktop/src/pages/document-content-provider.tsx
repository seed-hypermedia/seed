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
  ...overrides
}: React.PropsWithChildren<Partial<DocContentContextValue>> & {
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
  const importWebFile = trpc.webImporting.importWebFile.useMutation()
  const universalContext = useUniversalAppContext()
  return (
    <>
      <DocContentProvider
        showDevMenu={experiments.data?.pubContentDevMenu}
        layoutUnit={overrides.layoutUnit || contentLayoutUnit}
        importWebFile={importWebFile}
        textUnit={overrides.textUnit || contentTextUnit}
        debug={false}
        contacts={contacts.data}
        entityComponents={
          universalContext.entityComponents || {
            Document: () => null,
            Inline: () => null,
            Query: () => null,
            Comment: () => null,
          }
        }
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
