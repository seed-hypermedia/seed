import {Download} from '@tamagui/lucide-icons'
import {useAppContext} from '../app-context'
// import {usePublication} from '../models/documents'
import {useEntity} from '@/models/entities'
import {convertBlocksToMarkdown} from '@/utils/blocks-to-markdown'
import {HMBlockNode, toHMBlock, UnpackedHypermediaId} from '@shm/shared'
import {Button, Tooltip} from '@shm/ui'

export const ExportDocButton = ({
  docId,
}: {
  docId: UnpackedHypermediaId | undefined
}) => {
  const pub = useEntity(docId)
  const title = pub.data?.document?.metadata.name || 'document'
  const {exportDocument} = useAppContext()
  return (
    <>
      <Tooltip content={'Export Document to Markdown'}>
        <Button
          size="$2"
          theme="blue"
          onPress={async () => {
            const blocks: HMBlockNode[] | undefined =
              pub.data?.document?.content
            const editorBlocks = toHMBlock(blocks)
            const markdownWithFiles =
              await convertBlocksToMarkdown(editorBlocks)
            const {markdownContent, mediaFiles} = markdownWithFiles
            exportDocument(title, markdownContent, mediaFiles)
          }}
          icon={Download}
        >
          Export
        </Button>
      </Tooltip>
    </>
  )
}
