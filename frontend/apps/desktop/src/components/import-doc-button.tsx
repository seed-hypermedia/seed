import {useAppContext} from '@/app-context'
import {createHypermediaDocLinkPlugin, hmBlockSchema} from '@/editor'
import {useMyAccountsWithWriteAccess} from '@/models/access-control'
import {useGatewayUrlStream} from '@/models/gateway-settings'
import {useOpenUrl} from '@/open-url'
import {trpc} from '@/trpc'
import {BlockNoteEditor, type BlockSchema} from '@shm/editor/blocknote'
import {
  MarkdownToBlocks,
  processLinkMarkdown,
  processMediaMarkdown,
} from '@shm/editor/blocknote/core/extensions/Markdown/MarkdownToBlocks'
import {HMEntityContent, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {invalidateQueries, queryClient} from '@shm/shared/models/query-client'
import {Button} from '@shm/ui/button'
import {FileInput, FolderInput} from '@shm/ui/icons'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {toast} from '@shm/ui/toast'
import {Extension} from '@tiptap/core'
import matter from 'gray-matter'
import {nanoid} from 'nanoid'
import {ReactElement, useMemo} from 'react'
import {XStack} from 'tamagui'
import {
  DialogCloseButton,
  DialogDescription,
  DialogTitle,
  useAppDialog,
} from './dialog'
import {ImportedDocument, useImportConfirmDialog} from './import-doc-dialog'

export function useImportDialog() {
  return useAppDialog(ImportDialog)
}

export function ImportDialog({
  input,
  onClose,
}: {
  input: {onImportFile: () => void; onImportDirectory: () => void}
  onClose: () => void
}) {
  return (
    <>
      <DialogTitle>Import Documents</DialogTitle>
      <DialogDescription>
        You can import a single Markdown file, or a folder of Markdown files.
      </DialogDescription>
      <DialogCloseButton />
      <XStack>
        <Button
          onPress={() => {
            onClose()
            input.onImportFile()
          }}
        >
          Import File
        </Button>
        <Button
          onPress={() => {
            onClose()
            input.onImportDirectory()
          }}
        >
          Import Directory
        </Button>
      </XStack>
    </>
  )
}

export function ImportDropdownButton({
  id,
  button,
}: {
  id: UnpackedHypermediaId
  button: ReactElement
}) {
  const {importFile, importDirectory, content} = useImporting(id)

  return (
    <>
      <OptionsDropdown
        button={button}
        menuItems={[
          {
            key: 'file',
            label: 'Import Markdown File',
            onPress: () => importFile(),
            icon: FileInput,
          },
          {
            key: 'directory',
            label: 'Import Markdown Folder',
            onPress: () => importDirectory(),
            icon: FolderInput,
          },
        ]}
      />

      {content}
    </>
  )
}

export function useImporting(parentId: UnpackedHypermediaId) {
  const {openMarkdownDirectories, openMarkdownFiles} = useAppContext()
  const accts = useMyAccountsWithWriteAccess(parentId)
  const signingAccount = useMemo(() => {
    return accts.length ? accts[0].data : undefined
  }, [accts])
  const createDraft = trpc.drafts.write.useMutation()
  const {grpcClient} = useAppContext()
  const openUrl = useOpenUrl()
  const gwUrl = useGatewayUrlStream()
  const checkWebUrl = trpc.webImporting.checkWebUrl.useMutation()

  const importDialog = useImportConfirmDialog()

  function startImport(
    importFunction: (id: string) => Promise<{
      documents: ImportedDocument[]
      docMap: Map<string, {name: string; path: string}>
    }>,
  ) {
    importFunction(parentId.id)
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

    // const subDirs: string[] = []

    toast.promise(
      ImportDocumentsWithFeedback(
        parentId,
        createDraft,
        signingAccount,
        documents,
        docMap,
        editor,
      ),
      {
        loading: 'Importing documents...',
        success: `Imported ${documents.length} documents.`,
        error: (err) => `Failed to import documents: ${err.message}`,
      },
    )
  }

  return {
    importFile: () => startImport(openMarkdownFiles),
    importDirectory: () => startImport(openMarkdownDirectories),
    content: importDialog.content,
  }
}

const ImportDocumentsWithFeedback = (
  id: UnpackedHypermediaId,
  createDraft: any,
  signingAccount: HMEntityContent | null | undefined,
  documents: ImportedDocument[],
  docMap: Map<string, {name: string; path: string}>,
  editor: BlockNoteEditor,
) => {
  const pathCounter: {[key: string]: number} = {}
  return new Promise(async (resolve, reject) => {
    try {
      for (const {markdownContent, title, directoryPath} of documents) {
        let {data: frontmatter, content: markdown} = matter(markdownContent)

        // Process media and links in the markdown content
        markdown = await processMediaMarkdown(markdown, directoryPath)
        markdown = processLinkMarkdown(markdown, docMap)

        let documentTitle: string = frontmatter.title || title

        // If no title in frontmatter, check for an h1 as the first non-empty line
        if (!frontmatter.title) {
          let lines = markdown.split('\n')

          // Find the first non-empty line index
          const firstNonEmptyLineIndex = lines.findIndex(
            (line) => line.trim() !== '',
          )

          if (
            firstNonEmptyLineIndex !== -1 &&
            lines[firstNonEmptyLineIndex].startsWith('# ')
          ) {
            // Extract the h1 as the title and update documentTitle
            documentTitle = lines[firstNonEmptyLineIndex]
              .replace('# ', '')
              .trim()

            // Remove the h1 line from the markdown content
            lines.splice(firstNonEmptyLineIndex, 1)
            markdown = lines.join('\n')
          }
        }

        const icon = frontmatter.icon
        const cover = frontmatter.cover_image
        const createdAt = frontmatter.created_at
          ? new Date(frontmatter.created_at)
          : new Date()

        // let path = frontmatter.path
        //   ? frontmatter.path.slice(1)
        //   : pathNameify(documentTitle)

        // // Handle duplicate paths by appending a counter number
        // if (pathCounter[path]) {
        //   pathCounter[path] += 1
        //   path = `${path}-${pathCounter[path] - 1}`
        // } else {
        //   pathCounter[path] = 1
        // }

        const blocks = await MarkdownToBlocks(markdown, editor)

        // Commented code below is subdirectories import

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

        //     const publicationPath = id.path
        //       ? '/' + id.path?.join('/') + '/' + parentDir
        //       : '/' + parentDir

        //     const publishedDoc =
        //       await grpcClient.documents.createDocumentChange({
        //         signingKeyName: id.uid,
        //         account: id.uid,
        //         baseVersion: undefined,
        //         path: publicationPath,
        //         changes: allChanges,
        //         capability: '',
        //       })
        //   }

        //   await createDraft.mutateAsync({
        //     id: id.id + '/' + parentDir + '/' + path,
        //     draft: inputData,
        //   })
        // } else {
        //   await createDraft.mutateAsync({
        //     id: id.id + '/' + path,
        //     draft: inputData,
        //   })
        // }

        // const newId = hmId('d', id.uid, {
        //   path: [...(id.path || []), path],
        // })

        // const packedId = packHmId(newId)

        await createDraft.mutateAsync({
          id: nanoid(10),
          locationUid: id.uid,
          locationPath: id.path ? id.path : [],
          content: blocks,
          deps: [],
          metadata: {
            name: documentTitle,
            icon: icon ?? undefined,
            cover: cover ?? undefined,
          },
          signingAccount: signingAccount?.document?.account || undefined,
        })
      }
      resolve(`Imported ${documents.length} documents.`)

      invalidateQueries(['trpc.drafts.list'])
      invalidateQueries(['trpc.drafts.listAccount'])
    } catch (error) {
      console.error('Error importing documents:', error)
      reject(error)
    }
  })
}
