import {useAppContext, useQueryInvalidator} from '@/app-context'
import {
  BlockNoteEditor,
  BlockSchema,
  createHypermediaDocLinkPlugin,
  hmBlockSchema,
} from '@/editor'
import {
  MarkdownToBlocks,
  processLinkMarkdown,
  processMediaMarkdown,
} from '@/editor/blocknote/core/extensions/Markdown/MarkdownToBlocks'
import {useMyAccountIds} from '@/models/daemon'
import {useGatewayUrlStream} from '@/models/gateway-settings'
import {useOpenUrl} from '@/open-url'
import {trpc} from '@/trpc'
import {pathNameify} from '@/utils/path'
import {HMDraft, UnpackedHypermediaId} from '@shm/shared'
import {Button, OptionsDropdown, toast} from '@shm/ui'
import {FileInput, FolderInput, Import} from '@tamagui/lucide-icons'
import {Extension} from '@tiptap/core'
import {useMemo} from 'react'
import {ImportedDocument, useImportDialog} from './import-doc-dialog'

export function ImportButton({input}: {input: UnpackedHypermediaId}) {
  const {openMarkdownDirectories, openMarkdownFiles} = useAppContext()
  const keys = useMyAccountIds()
  const signingAccount = useMemo(() => {
    return keys.data?.length ? keys.data[0] : undefined
  }, [keys.data])
  // const navigate = useNavigate()
  const saveDraft = trpc.drafts.write.useMutation()
  const {queryClient, grpcClient} = useAppContext()
  const openUrl = useOpenUrl()
  const gwUrl = useGatewayUrlStream()
  const checkWebUrl = trpc.webImporting.checkWebUrl.useMutation()
  const invalidate = useQueryInvalidator()

  const importDialog = useImportDialog()

  const importDocuments = async (type: 'directory' | 'file') => {
    const openFunction =
      type === 'directory' ? openMarkdownDirectories : openMarkdownFiles

    if (typeof openFunction !== 'function') {
      return
    }

    openFunction(input.id)
      .then(async (result) => {
        const docs = result.documents
        if (docs.length) {
          importDialog.open({
            documents: docs,
            documentCount: docs.length,
            docMap: result.docMap,
            onSuccess: handleConfirm,
          })
        } else {
          toast.error('No documents found inside the selected directory.')
        }
      })
      .catch((error) => {
        console.error('Error importing documents:', error)
        toast.error(`Import error: ${error.message || error}`)
      })
  }

  const handleConfirm = async (
    documents: ImportedDocument[],
    docMap: Map<string, {name: string; path: string}>,
  ) => {
    const editor = new BlockNoteEditor<BlockSchema>({
      linkExtensionOptions: {
        openOnClick: false,
        queryClient,
        grpcClient,
        gwUrl,
        openUrl,
        checkWebUrl: checkWebUrl.mutate,
      },
      blockSchema: hmBlockSchema,
      _tiptapOptions: {
        extensions: [
          Extension.create({
            name: 'hypermedia-link',
            addProseMirrorPlugins() {
              return [
                createHypermediaDocLinkPlugin({
                  queryClient,
                }).plugin,
              ]
            },
          }),
        ],
      },
    })

    const titleCounter: {[key: string]: number} = {}

    // const subDirs: string[] = []

    try {
      for (const {markdownContent, title, directoryPath} of documents) {
        let markdown = await processMediaMarkdown(
          markdownContent,
          directoryPath,
        )

        markdown = processLinkMarkdown(markdown, docMap)

        let lines = markdown.split('\n')

        // first non-empty line index
        const firstNonEmptyLineIndex = lines.findIndex(
          (line) => line.trim() !== '',
        )

        let documentTitle: string = title
        // Check if the first non-empty line is an h1
        if (
          firstNonEmptyLineIndex !== -1 &&
          lines[firstNonEmptyLineIndex].startsWith('# ')
        ) {
          // Extract the h1 as the title
          documentTitle = lines[firstNonEmptyLineIndex].replace('# ', '').trim()

          // Remove the h1 line from the markdown content
          lines = lines.filter((_, index) => index !== firstNonEmptyLineIndex)

          // Rejoin the lines back into the markdown content without the h1
          markdown = lines.join('\n')
        }

        let path = pathNameify(documentTitle)

        // Handle duplicate titles by appending a counter number
        if (titleCounter[documentTitle]) {
          titleCounter[documentTitle] += 1
          path = pathNameify(`${documentTitle}-${titleCounter[documentTitle]}`)
        } else {
          titleCounter[documentTitle] = 1
        }

        const blocks = await MarkdownToBlocks(markdown, editor)
        let inputData: Partial<HMDraft> = {
          content: blocks,
          deps: [],
          metadata: {
            name: documentTitle,
          },
          members: {},
          signingAccount,
        }

        // const parentDir = directoryPath.split('/').pop()!
        // if (parentDir !== documents[0].directoryPath.split('/').pop()!) {
        //   if (!subDirs.includes(parentDir)) {
        //     subDirs.push(parentDir)

        //     const allChanges = [
        //       new DocumentChange({
        //         op: {
        //           case: 'setMetadata',
        //           value: {
        //             key: 'name',
        //             value: parentDir,
        //           },
        //         },
        //       }),
        //     ]

        //     const publicationPath = input.path
        //       ? '/' + input.path?.join('/') + '/' + parentDir
        //       : '/' + parentDir

        //     const publishedDoc =
        //       await grpcClient.documents.createDocumentChange({
        //         signingKeyName: input.uid,
        //         account: input.uid,
        //         baseVersion: undefined,
        //         path: publicationPath,
        //         changes: allChanges,
        //         capability: '',
        //       })
        //   }

        //   await saveDraft.mutateAsync({
        //     id: input.id + '/' + parentDir + '/' + path,
        //     draft: inputData,
        //   })
        // } else {
        //   await saveDraft.mutateAsync({
        //     id: input.id + '/' + path,
        //     draft: inputData,
        //   })
        // }
        await saveDraft.mutateAsync({
          id: input.id + '/' + path,
          draft: inputData,
        })
      }

      invalidate(['trpc.drafts.list'])
    } catch (error) {
      console.error('Error importing documents:', error)
      toast.error(`Import error: ${error.message || error}`)
    }
  }

  return (
    <>
      <OptionsDropdown
        button={<Button size="$3" icon={Import}></Button>}
        menuItems={[
          {
            key: 'file',
            label: 'Import Markdown File',
            onPress: () => importDocuments('file'),
            icon: FileInput,
          },
          {
            key: 'directory',
            label: 'Import Markdown Folder',
            onPress: () => importDocuments('directory'),
            icon: FolderInput,
          },
        ]}
      />

      {importDialog.content}
    </>
  )
}
