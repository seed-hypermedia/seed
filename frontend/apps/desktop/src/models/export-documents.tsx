import {useAppContext} from '@/app-context'
import {grpcClient} from '@/grpc-client'
import {convertBlocksToMarkdown} from '@/utils/blocks-to-markdown'
import {toPlainMessage} from '@bufbuild/protobuf'
import {hmBlocksToEditorContent} from '@shm/shared/client/hmblock-to-editorblock'
import {getDocumentTitle} from '@shm/shared/content'
import {EditorBlock} from '@shm/shared/editor-types'
import {HMDocumentMetadataSchema, HMDocumentSchema} from '@shm/shared/hm-types'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {YStack} from 'tamagui'

export function useExportDocuments() {
  const {exportDocuments, openDirectory} = useAppContext()

  return async (docIds: string[]) => {
    if (docIds.length == 0) {
      toast.error('No documents selected')
      return
    }
    const docsToExport = await Promise.all(
      docIds.map(async (idStr) => {
        const id = unpackHmId(idStr)
        if (!id) return null
        const doc = await grpcClient.documents.getDocument({
          account: id.uid,
          path: hmIdPathToEntityQueryPath(id.path),
        })
        const hmDocParse = HMDocumentSchema.safeParse({
          ...toPlainMessage(doc),
          metadata: HMDocumentMetadataSchema.parse(
            doc.metadata?.toJson({emitDefaultValues: true}),
          ),
        })
        const hmDoc = hmDocParse.success ? hmDocParse.data : null
        if (!hmDoc) return null
        const editorBlocks: EditorBlock[] = hmBlocksToEditorContent(
          hmDoc.content,
        )
        const markdown = await convertBlocksToMarkdown(editorBlocks, hmDoc)
        return {
          title: getDocumentTitle(hmDoc) || 'Untitled document',
          markdown,
        }
      }),
    )
    await exportDocuments(docsToExport.filter((doc) => doc !== null))
      .then((res) => {
        const success = (
          <>
            <YStack gap="$1.5" maxWidth={700}>
              <SizableText className="break-words">
                Successfully exported documents to: <b>{`${res}`}</b>.
              </SizableText>
              <SizableText
                color="brand"
                asChild
                className="underline cursor-pointer"
              >
                <a
                  onClick={() => {
                    openDirectory(res)
                  }}
                >
                  Show directory
                </a>
              </SizableText>
            </YStack>
          </>
        )
        toast.success('', {customContent: success})
      })
      .catch((err) => {
        toast.error(err)
      })
  }
}
