import {useAppContext} from '@/app-context'
import {grpcClient} from '@/grpc-client'
import {convertBlocksToMarkdown} from '@/utils/blocks-to-markdown'
import {hmBlocksToEditorContent} from '@shm/shared/client/hmblock-to-editorblock'
import {getDocumentTitle} from '@shm/shared/content'
import {prepareHMDocument} from '@shm/shared/document-utils'
import {EditorBlock} from '@shm/shared/editor-types'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'

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
        const hmDoc = prepareHMDocument(doc)
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
            <div className="flex max-w-[700px] flex-col gap-1.5">
              <SizableText className="break-words">
                Successfully exported documents to: <b>{`${res}`}</b>.
              </SizableText>
              <SizableText
                color="brand"
                asChild
                className="cursor-pointer underline"
              >
                <a
                  onClick={() => {
                    openDirectory(res)
                  }}
                >
                  Show directory
                </a>
              </SizableText>
            </div>
          </>
        )
        // @ts-expect-error
        toast.success('', {customContent: success})
      })
      .catch((err) => {
        toast.error(err)
      })
  }
}
