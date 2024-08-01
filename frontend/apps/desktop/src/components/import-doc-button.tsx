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
import {pathNameify} from '@/utils/path'
import {useNavigate} from '@/utils/useNavigate'
import {HMDraft, UnpackedHypermediaId} from '@shm/shared'
import {
  Button,
  Popover,
  PopoverContent,
  SizableText,
  XStack,
  YStack,
} from '@shm/ui'
import {Extension} from '@tiptap/core'
import {useMemo, useState} from 'react'

export const ImportButton = ({input}: {input: UnpackedHypermediaId}) => {
  const {openMarkdownDirectories, openMarkdownFiles} = useAppContext()
  const keys = useMyAccountIds()
  const signingProfile = useMemo(() => {
    return keys.data?.length === 1 ? keys.data[0] : undefined // TODO: @horacio need to add a "key selector" here
  }, [keys.data])
  const navigate = useNavigate()
  const saveDraft = trpc.drafts.write.useMutation()
  const {queryClient, grpcClient} = useAppContext()
  const openUrl = useOpenUrl()
  const gwUrl = useGatewayUrlStream()
  const checkWebUrl = trpc.webImporting.checkWebUrl.useMutation()
  const showNostr = trpc.experiments.get.useQuery().data?.nostr

  const [isPopoverOpen, setIsPopoverOpen] = useState(false)

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
      console.error(`The function for type '${type}' is not defined correctly.`)
      return
    }

    openFunction()
      .then(async (documents) => {
        for (const {markdownContent, mediaFiles, title} of documents) {
          console.log(title)
          const updatedMarkdownContent = await uploadAndReplaceMediaUrls(
            markdownContent,
            mediaFiles,
          )
          const blocks = await MarkdownToBlocks(
            updatedMarkdownContent,
            editor,
            mediaFiles.length > 0, // Pass true if mediaFiles is provided, otherwise false
          )
          const path = pathNameify(title)
          let inputData: Partial<HMDraft> = {}
          inputData = {
            content: blocks,
            deps: [],
            metadata: {
              name: title,
            },
            members: {},
            signingProfile,
          }

          console.log(input.id, path, title)

          const draft = await saveDraft.mutateAsync({
            id: input.id + '/' + path,
            draft: inputData,
          })
          // navigate({key: 'draft', id: draft.id}) // Uncomment this line to navigate to the newly created draft
        }
      })
      .catch((error) => {
        console.error('Error importing documents:', error)
        // Show a toast or notification for the error
      })
      .finally(() => {
        setIsPopoverOpen(false)
      })
  }

  return (
    <YStack>
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <Popover.Trigger>
          <Button onPress={() => setIsPopoverOpen(true)}>
            Import Document
          </Button>
        </Popover.Trigger>

        {isPopoverOpen && (
          <PopoverContent padding="$4">
            <SizableText size="$4" fontWeight="bold">
              Import from
            </SizableText>
            <SizableText size="$2">Select the source:</SizableText>
            <XStack marginTop="$2" space="$3" justifyContent="center">
              <Button
                size="$2"
                onPress={() => importDocuments('file')}
                style={{
                  whiteSpace: 'pre-wrap',
                  textAlign: 'center',
                  height: 'auto',
                }}
              >
                External Source
              </Button>
              <Button
                size="$2"
                onPress={() => importDocuments('directory')}
                style={{
                  whiteSpace: 'pre-wrap',
                  textAlign: 'center',
                  height: 'auto',
                }}
              >
                Mintter App
              </Button>
            </XStack>
          </PopoverContent>
        )}
      </Popover>
    </YStack>
  )
}
