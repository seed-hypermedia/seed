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
import {Button, File} from '@shm/ui'
import {Folder, Upload} from '@tamagui/lucide-icons'
import {Extension} from '@tiptap/core'
import {useMemo} from 'react'
import {MenuItemType, OptionsDropdown} from './options-dropdown'

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

    openFunction()
      .then(async (documents) => {
        for (const {markdownContent, title, directoryPath} of documents) {
          const updatedMarkdownContent = await processMediaMarkdown(
            markdownContent,
            directoryPath,
          )
          const blocks = await MarkdownToBlocks(updatedMarkdownContent, editor)
          const path = pathNameify(title)
          let inputData: Partial<HMDraft> = {}
          inputData = {
            content: blocks,
            deps: [],
            metadata: {
              name: title,
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

  const menuItems: MenuItemType[] = [
    {
      key: 'importFile',
      icon: File,
      onPress: () => importDocuments('file'),
      label: 'Import Markdown File',
    },
    {
      key: 'importDir',
      icon: Folder,
      onPress: () => importDocuments('directory'),
      label: 'Import Directory',
    },
  ]

  const TriggerButton = (
    <Button icon={Upload} marginLeft="$2">
      Import Document
    </Button>
  )

  return (
    <>
      <OptionsDropdown menuItems={menuItems} button={TriggerButton} />
    </>
  )
}
