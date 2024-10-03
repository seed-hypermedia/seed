import {useAppContext, useQueryInvalidator} from '@/app-context'
import {
  BlockNoteEditor,
  BlockSchema,
  createHypermediaDocLinkPlugin,
  hmBlockSchema,
} from '@/editor'
import {
  MarkdownToBlocks,
  processMediaMarkdown,
} from '@/editor/blocknote/core/extensions/Markdown/MarkdownToBlocks'
import {useMyAccountIds} from '@/models/daemon'
import {useGatewayUrlStream} from '@/models/gateway-settings'
import {useOpenUrl} from '@/open-url'
import {trpc} from '@/trpc'
import {pathNameify} from '@/utils/path'
import {useNavigate} from '@/utils/useNavigate'
import {HMDraft, UnpackedHypermediaId} from '@shm/shared'
import {Button} from '@shm/ui'
import {FileInput, FolderInput, Import} from '@tamagui/lucide-icons'
import {Extension} from '@tiptap/core'
import {useMemo} from 'react'
import {OptionsDropdown} from './options-dropdown'

export const ImportButton = ({input}: {input: UnpackedHypermediaId}) => {
  const {openMarkdownDirectories, openMarkdownFiles} = useAppContext()
  const keys = useMyAccountIds()
  const signingAccount = useMemo(() => {
    return keys.data?.length ? keys.data[0] : undefined
  }, [keys.data])
  const navigate = useNavigate()
  const saveDraft = trpc.drafts.write.useMutation()
  const {queryClient, grpcClient} = useAppContext()
  const openUrl = useOpenUrl()
  const gwUrl = useGatewayUrlStream()
  const checkWebUrl = trpc.webImporting.checkWebUrl.useMutation()
  const invalidate = useQueryInvalidator()

  const importDocuments = async (type: 'directory' | 'file') => {
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

    const openFunction =
      type === 'directory' ? openMarkdownDirectories : openMarkdownFiles

    if (typeof openFunction !== 'function') {
      return
    }

    const titleCounter: {[key: string]: number} = {}

    openFunction()
      .then(async (documents) => {
        for (const {markdownContent, title, directoryPath} of documents) {
          let markdown = await processMediaMarkdown(
            markdownContent,
            directoryPath,
          )

          let lines = markdown.split('\n')

          // first non-empty line index
          const firstNonEmptyLineIndex = lines.findIndex(
            (line) => line.trim() !== '',
          )

          let documentTitle = title
          // Check if the first non-empty line is an h1
          if (
            firstNonEmptyLineIndex !== -1 &&
            lines[firstNonEmptyLineIndex].startsWith('# ')
          ) {
            // Extract the h1 as the title
            documentTitle = lines[firstNonEmptyLineIndex]
              .replace('# ', '')
              .trim()

            // Remove the h1 line from the markdown content
            lines = lines.filter((_, index) => index !== firstNonEmptyLineIndex)

            // Rejoin the lines back into the markdown content without the h1
            markdown = lines.join('\n')
          }

          let path = pathNameify(documentTitle)

          // Handle duplicate titles by appending a counter if necessary
          if (titleCounter[documentTitle]) {
            titleCounter[documentTitle] += 1
            path = pathNameify(
              `${documentTitle}-${titleCounter[documentTitle]}`,
            )
          } else {
            titleCounter[documentTitle] = 1
          }

          const blocks = await MarkdownToBlocks(markdown, editor)
          let inputData: Partial<HMDraft> = {}
          inputData = {
            content: blocks,
            deps: [],
            metadata: {
              name: documentTitle,
            },
            members: {},
            signingAccount,
          }

          const draft = await saveDraft.mutateAsync({
            id: input.id + '/' + path,
            draft: inputData,
          })
          // navigate({key: 'draft', id: draft.id}) // Uncomment this line to navigate to the newly created draft
        }
        invalidate(['trpc.drafts.list'])
      })
      .catch((error) => {
        console.error('Error importing documents:', error)
        // Show a toast or notification for the error
      })
  }

  return (
    <OptionsDropdown
      button={
        <Button size="$3" icon={Import}>
          Import Document
        </Button>
      }
      menuItems={[
        {
          key: 'file',
          label: 'Import Markdown File',
          onPress: () => importDocuments('file'),
          icon: FileInput,
        },
        {
          key: 'directory',
          label: 'Import Markdown Directory',
          onPress: () => importDocuments('directory'),
          icon: FolderInput,
        },
      ]}
    />
  )
}
