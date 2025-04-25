import {useAppContext} from '@/app-context'
import {
  EmbedComment,
  EmbedDocument,
  EmbedInline,
  QueryBlockDesktop,
} from '@/components/app-embeds'
import {useExperiments} from '@/models/experiments'
import {useOpenUrl} from '@/open-url'
import {trpc} from '@/trpc'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {BlockRange, ExpandedBlockRange} from '@shm/shared/utils/entity-id-url'
import {
  DocContentContextValue,
  DocContentProvider,
} from '@shm/ui/document-content'
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
        entityComponents={{
          Document: EmbedDocument,
          Comment: EmbedComment,
          Inline: EmbedInline,
          Query: QueryBlockDesktop,
        }}
        onCopyBlock={
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
        {...overrides}
      >
        {children}
      </DocContentProvider>
      {reference?.content}
    </>
  )
}
