import {useAppContext} from '@/app-context'
import {
  createHypermediaDocLinkPlugin,
  hmBlockSchema,
  useBlockNote,
} from '@/editor'
import {MarkdownToBlocks} from '@/editor/blocknote/core/extensions/Markdown/MarkdownToBlocks'
import {useMyAccountIds} from '@/models/daemon'
import {useGatewayUrlStream} from '@/models/gateway-settings'
import {useOpenUrl} from '@/open-url'
import {slashMenuItems} from '@/slash-menu-items'
import {trpc} from '@/trpc'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {HMDraft} from '@shm/shared'
import {Button} from '@shm/ui'
import {Extension} from '@tiptap/core'
import {nanoid} from 'nanoid'
import {useMemo} from 'react'

export const ImportButton = () => {
  const {openMarkdownFile} = useAppContext()
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
  const editor = useBlockNote<typeof hmBlockSchema>({
    linkExtensionOptions: {
      openOnClick: false,
      queryClient,
      grpcClient,
      gwUrl,
      openUrl,
      checkWebUrl: checkWebUrl.mutate,
    },
    blockSchema: hmBlockSchema,
    slashMenuItems: !showNostr
      ? slashMenuItems.filter((item) => item.name != 'Nostr')
      : slashMenuItems,
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

  // console.log(openMarkdownFile)
  // const importDocument = () => {}
  const importDocument = async () => {
    openMarkdownFile()
      .then(async (res) => {
        const blocks = await MarkdownToBlocks(res as string, editor)
        let inputData: Partial<HMDraft> = {}
        const draftId = `hm://draft/${nanoid()}`
        inputData = {
          content: blocks,
          deps: [],
          metadata: {
            name: 'test',
            // name: input.name,
            // thumbnail: input.thumbnail,
          },
          members: {},
          index: {},
          // indexPath: input.indexPath,
          signingProfile,
        }

        const draft = await saveDraft.mutateAsync({
          id: draftId,
          draft: inputData,
        })
        // replaceRoute({key: 'draft', id: draft.id})
        navigate({key: 'draft', id: draft.id})
        console.log(draft, route)
        // console.log('File content:', res)

        // Handle the file content (e.g., set state, display in UI)
      })
      .catch((error) => {
        console.error('Error importing document:', error)
      })
  }
  return (
    <Button size="$2" onPress={importDocument}>
      Import Draft
    </Button>
  )
}
