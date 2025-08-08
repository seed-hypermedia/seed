import {useAppContext} from '@/app-context'
import {hmBlockSchema} from '@/editor'
import {useMyAccountsWithWriteAccess} from '@/models/access-control'
import {useGatewayUrlStream} from '@/models/gateway-settings'
import {useOpenUrl} from '@/open-url'
import {trpc} from '@/trpc'
import {useNavigate} from '@/utils/useNavigate'
import {ScrapeStatus} from '@/web-scraper'
import {zodResolver} from '@hookform/resolvers/zod'
import {BlockNoteEditor, type BlockSchema} from '@shm/editor/blocknote'
import {
  MarkdownToBlocks,
  processLinkMarkdown,
  processMediaMarkdown,
} from '@shm/editor/blocknote/core/extensions/Markdown/MarkdownToBlocks'
import {createHypermediaDocLinkPlugin} from '@shm/editor/hypermedia-link-plugin'
import {HMEntityContent, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {invalidateQueries, queryClient} from '@shm/shared/models/query-client'
import {Button} from '@shm/ui/button'
import {FormInput} from '@shm/ui/form-input'
import {FormField} from '@shm/ui/forms'
import {HMIcon} from '@shm/ui/hm-icon'
import {File, FileInput, Folder, FolderInput, Globe} from '@shm/ui/icons'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shm/ui/select-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {
  DialogCloseButton,
  DialogDescription,
  DialogTitle,
  useAppDialog,
} from '@shm/ui/universal-dialog'
import {Extension} from '@tiptap/core'
import matter from 'gray-matter'
import {nanoid} from 'nanoid'
import {ReactElement, useEffect, useMemo, useState} from 'react'
import {useForm} from 'react-hook-form'
import {z} from 'zod'
import {ImportedDocument, useImportConfirmDialog} from './import-doc-dialog'

export function useImportDialog() {
  return useAppDialog(ImportDialog)
}

export function ImportDialog({
  input,
  onClose,
}: {
  input: {
    onImportFile: () => void
    onImportDirectory: () => void
    onImportWebSite: () => void
    onImportWordpress: () => void
  }
  onClose: () => void
}) {
  return (
    <>
      <DialogTitle>Import Documents</DialogTitle>
      <DialogDescription>
        You can import a single Markdown file, or a folder of Markdown files.
      </DialogDescription>
      <DialogCloseButton />
      <div className="flex flex-col gap-4">
        <Button
          className="border-border border"
          variant="ghost"
          onClick={() => {
            onClose()
            input.onImportFile()
          }}
        >
          <File className="size-3" />
          Import File
        </Button>
        <Button
          className="border-border border"
          variant="ghost"
          onClick={() => {
            onClose()
            input.onImportDirectory()
          }}
        >
          <Folder className="size-3" />
          Import Directory
        </Button>
        <Button
          className="border-border border"
          variant="ghost"
          onClick={() => {
            onClose()
            input.onImportWebSite()
          }}
        >
          <Globe className="size-3" />
          Import Web Site
        </Button>
        <Button
          className="border-border border"
          variant="ghost"
          onClick={() => {
            onClose()
            input.onImportWordpress()
          }}
        >
          <File className="size-3" />
          Import WordPress Site
        </Button>
      </div>
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
            onClick: () => importFile(),
            icon: <FileInput className="size-4" />,
          },
          {
            key: 'directory',
            label: 'Import Markdown Folder',
            onClick: () => importDirectory(),
            icon: <FolderInput className="size-4" />,
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
  const navigate = useNavigate()
  const signingAccount = useMemo(() => {
    // @ts-ignore
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
        // @ts-expect-error
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
      ).then((draftIds) => {
        if (draftIds.draftIds.length === 1) {
          // @ts-ignore
          navigate({key: 'draft', id: draftIds.draftIds[0]})
        }
        return draftIds.draftIds.length
      }),
      {
        loading: 'Importing documents...',
        success: `Imported ${documents.length} documents.`,
        error: (err) => `Failed to import documents: ${err.message}`,
      },
    )
  }

  const webImporting = useWebImporting()
  const wpImporting = useWordpressImporting()

  return {
    importFile: () => startImport(openMarkdownFiles),
    importDirectory: () => startImport(openMarkdownDirectories),
    importWebSite: () => webImporting.open({destinationId: parentId}),
    importWordpress: () => wpImporting.open({destinationId: parentId}),
    content: (
      <>
        {importDialog.content}
        {webImporting.content}
        {wpImporting.content}
      </>
    ),
  }
}

export function useWordpressImporting() {
  return useAppDialog(WordpressImportDialog)
}

function WordpressImportDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {
    destinationId: UnpackedHypermediaId
    defaultUrl?: string
  }
}) {
  const [importId, setImportId] = useState<string | null>(null)
  const [hostname, setHostname] = useState<string | null>(null)
  const startImport = trpc.webImporting.importWpSite.useMutation()

  return (
    <div className="flex flex-col gap-3">
      <DialogTitle>Import WordPress Site</DialogTitle>
      <ImportURLForm
        defaultUrl={input.defaultUrl}
        onSubmit={(url) => {
          const hostname = new URL(url).host
          setHostname(hostname)
          startImport.mutateAsync({url}).then(({importId}) => {
            console.log('here?????', importId)
            setImportId(importId)
          })

          toast('Import Started.')
          console.log('url', url)
        }}
      />
    </div>
  )
}

export function useWebImporting() {
  return useAppDialog(WebImportDialog)
}

function WebImportDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {
    destinationId: UnpackedHypermediaId
    defaultUrl?: string
  }
}) {
  const [importId, setImportId] = useState<string | null>(null)
  const [hostname, setHostname] = useState<string | null>(null)
  const startImport = trpc.webImporting.importWebSite.useMutation()

  return (
    <>
      {importId && hostname ? (
        <WebImportInProgress
          id={importId}
          onComplete={onClose}
          destinationId={input.destinationId}
          hostname={hostname}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <DialogTitle>Import Web Site</DialogTitle>
          <ImportURLForm
            defaultUrl={input.defaultUrl}
            onSubmit={(url) => {
              const hostname = new URL(url).host
              setHostname(hostname)
              startImport.mutateAsync({url}).then(({importId}) => {
                setImportId(importId)
              })

              toast('Import Started.')
              console.log('url', url)
            }}
          />
        </div>
      )}
    </>
  )
}

function WebImportInProgress({
  id,
  onComplete,
  destinationId,
  hostname,
}: {
  id: string
  onComplete: () => void
  destinationId: UnpackedHypermediaId
  hostname: string
}) {
  const {data: status} = trpc.webImporting.importWebSiteStatus.useQuery(id, {
    refetchInterval: 250,
  })
  const confirmImport = trpc.webImporting.importWebSiteConfirm.useMutation()
  const accounts = useMyAccountsWithWriteAccess(destinationId)
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedAccount && accounts[0]?.data?.id.uid) {
      setSelectedAccount(accounts[0].data?.id.uid)
    }
  }, [selectedAccount, accounts.map((a) => a.data?.id.uid)])
  const result = status?.mode === 'ready' ? status.result : undefined

  if (result && !confirmImport.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <DialogTitle>Ready to import from {hostname}</DialogTitle>
        <SizableText>{result.posts.length} posts ready for import</SizableText>
        {selectedAccount && (
          <Select value={selectedAccount} onValueChange={setSelectedAccount}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select Account" />
            </SelectTrigger>
            <SelectContent>
              {accounts
                .map((a) => {
                  const id = a.data?.id
                  if (!id) return null
                  return (
                    <SelectItem key={id.uid} value={id.uid}>
                      <div className="flex items-center gap-2">
                        <HMIcon
                          size={24}
                          id={id}
                          // @ts-expect-error
                          metadata={a.data?.document?.metadata}
                        />
                        {/* @ts-expect-error */}
                        {a.data?.document?.metadata.name || ''}
                      </div>
                    </SelectItem>
                  )
                })
                .filter((a) => !!a)}
            </SelectContent>
          </Select>
        )}

        <Button
          variant="ghost"
          onClick={() => {
            if (!selectedAccount) {
              toast.error('No account found')
              return
            }
            confirmImport
              .mutateAsync({
                importId: id,
                destinationId: destinationId.id,
                signAccountUid: selectedAccount,
              })
              .then(() => {
                toast.success('Import Complete.')
                onComplete()
              })
          }}
        >
          {`Import & Publish ${result?.posts.length} pages`}
        </Button>
      </div>
    )
  } else if (
    status?.mode === 'importing' ||
    status?.mode === 'scraping' ||
    confirmImport.isLoading
  ) {
    const scrapeStatus: ScrapeStatus | undefined =
      status?.mode === 'scraping' ? status : undefined
    return (
      <div className="flex flex-col gap-4">
        <DialogTitle>Importing from {hostname}...</DialogTitle>
        {scrapeStatus?.visitedCount ? (
          <SizableText>
            {scrapeStatus?.visitedCount} pages visited,{' '}
            {scrapeStatus?.crawlQueueCount || '0'} queued (
            {scrapeStatus?.scrapeMode})
          </SizableText>
        ) : null}
        {scrapeStatus ? (
          <SizableText color="muted" size="sm" className="truncate">
            {scrapeStatus?.activeUrl}
          </SizableText>
        ) : null}
        {status?.mode === 'importing' ? (
          <SizableText>Preparing...</SizableText>
        ) : null}
        {confirmImport.isLoading ? (
          <SizableText>Importing...</SizableText>
        ) : null}
        <Spinner size="small" />
      </div>
    )
  } else if (status?.mode === 'error') {
    return (
      <div className="flex flex-col gap-4">
        <DialogTitle>Error importing from {hostname}</DialogTitle>
        <SizableText color="destructive">Error: {status.error}</SizableText>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <DialogTitle color="$red10">Unexpected Importer Situation</DialogTitle>
    </div>
  )
}

const ImportURLSchema = z.object({
  url: z.string().url(),
})
type ImportURLFields = z.infer<typeof ImportURLSchema>
function ImportURLForm({
  onSubmit,
  defaultUrl,
}: {
  onSubmit: (url: string) => void
  defaultUrl?: string
}) {
  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<ImportURLFields>({
    resolver: zodResolver(ImportURLSchema),
    defaultValues: {
      url: defaultUrl,
    },
  })
  return (
    <form onSubmit={handleSubmit(({url}) => onSubmit(url))}>
      <div className="flex flex-col gap-4">
        <FormField name="url" label="Web URL" errors={errors} width={400}>
          <FormInput
            // disabled={isSendingEmail}
            control={control}
            name="url"
            placeholder="https://example.com"
          />
        </FormField>

        <Button type="submit" variant="default">
          Import Site
        </Button>

        {/* <AnimatedSpinner isVisible={isSendingEmail} /> */}
      </div>
    </form>
  )
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
  return new Promise<{draftIds: string[]}>(async (resolve, reject) => {
    const draftIds: string[] = []
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
            // @ts-ignore
            lines[firstNonEmptyLineIndex].startsWith('# ')
          ) {
            // Extract the h1 as the title and update documentTitle
            // @ts-ignore
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

        // const newId = hmId( id.uid, {
        //   path: [...(id.path || []), path],
        // })

        // const packedId = packHmId(newId)

        const draftId = nanoid(10)

        await createDraft.mutateAsync({
          id: draftId,
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
        draftIds.push(draftId)
      }
      resolve({draftIds})
      // `Imported ${documents.length} documents.`)

      invalidateQueries(['trpc.drafts.list'])
      invalidateQueries(['trpc.drafts.listAccount'])
    } catch (error) {
      console.error('Error importing documents:', error)
      reject(error)
    }
  })
}
