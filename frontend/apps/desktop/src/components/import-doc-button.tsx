import {useAppContext} from '@/app-context'
import {
  BlockNoteEditor,
  BlockSchema,
  createHypermediaDocLinkPlugin,
  hmBlockSchema,
} from '@/editor'
import {
  MarkdownToBlocks,
  uploadAndReplaceMediaUrls,
} from '@/editor/blocknote/core/extensions/Markdown/MarkdownToBlocks'
import {useMyAccountIds} from '@/models/daemon'
import {useGatewayUrlStream} from '@/models/gateway-settings'
import {useOpenUrl} from '@/open-url'
import {trpc} from '@/trpc'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {HMDraft} from '@shm/shared'
import {Button} from '@shm/ui'
import {Extension} from '@tiptap/core'
import {nanoid} from 'nanoid'
import {useMemo} from 'react'

export const ImportButton = () => {
  // const {openMarkdownFile} = useAppContext()
  const {openMarkdownDirectories} = useAppContext()
  const keys = useMyAccountIds()
  const signingProfile = useMemo(() => {
    return keys.data?.length == 1 ? keys.data[0] : undefined // TODO: @horacio need to add a "key selector" here
  }, [keys.data])
  const route = useNavRoute()
  const navigate = useNavigate()
  const replaceRoute = useNavigate('replace')
  const saveDraft = trpc.drafts.write.useMutation()
  const {queryClient, grpcClient} = useAppContext()
  const openUrl = useOpenUrl()
  const gwUrl = useGatewayUrlStream()
  const checkWebUrl = trpc.webImporting.checkWebUrl.useMutation()
  const showNostr = trpc.experiments.get.useQuery().data?.nostr

  const importDocuments = async () => {
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

    openMarkdownDirectories()
      .then(async (documents) => {
        for (const {markdownContent, mediaFiles} of documents) {
          const updatedMarkdownContent = await uploadAndReplaceMediaUrls(
            markdownContent,
            mediaFiles,
          )
          const blocks = await MarkdownToBlocks(updatedMarkdownContent, editor)
          let inputData: Partial<HMDraft> = {}
          const draftId = `hm://draft/${nanoid()}`
          inputData = {
            content: blocks,
            deps: [],
            metadata: {
              name: 'Imported Document',
            },
            members: {},
            index: {},
            signingProfile,
          }

          const draft = await saveDraft.mutateAsync({
            id: draftId,
            draft: inputData,
          })
          // navigate({key: 'draft', id: draft.id})
          console.log(draft, route)
        }
      })
      .catch((error) => {
        console.error('Error importing documents:', error)
        // Show a toast or notification for the error
      })
  }

  return (
    <Button size="$2" onPress={importDocuments}>
      Import Draft
    </Button>
  )
}
