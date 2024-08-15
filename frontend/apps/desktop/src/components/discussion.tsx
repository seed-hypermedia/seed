import {useCommentEditor} from '@/models/comments'
import {useMyAccounts} from '@/models/daemon'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {
  getDocumentTitle,
  HMEntityContent,
  StateStream,
  UnpackedHypermediaId,
} from '@shm/shared'
import {
  Button,
  ReplyArrow,
  SelectDropdown,
  SizableText,
  Tooltip,
  UIAvatar,
  useStream,
  View,
  XStack,
  YStack,
} from '@shm/ui'
import {ChevronRight, Trash} from '@tamagui/lucide-icons'
import {HMEditorContainer, HyperMediaEditorView} from './editor'
import {Thumbnail} from './thumbnail'

export function Discussion({docId}: {docId: UnpackedHypermediaId}) {
  return (
    <YStack p="$4" gap="$4">
      <CommentDraft docId={docId} />
      <YStack>
        <XStack gap="$2" padding="$2">
          <UIAvatar label="Foo" size={20} />
          <YStack f={1} gap="$2">
            <XStack minHeight={20} ai="center" gap="$2">
              <SizableText size="$2" fontWeight="bold">
                Alice
              </SizableText>
              <SizableText color="$color8" size="$1">
                1 day ago
              </SizableText>
            </XStack>
            <XStack>
              <SizableText>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ornare
                rutrum amet, a nunc mi lacinia in iaculis. Pharetra ut integer
                nibh urna. Placerat ut adipiscing nulla lectus vulputate massa,
                scelerisque. Netus nisl nulla placerat dignissim ipsum arcu.
              </SizableText>
            </XStack>
            <XStack ai="center" gap="$2" marginLeft={-4} paddingVertical="$1">
              <Button
                chromeless
                color="$blue11"
                size="$1"
                theme="blue"
                icon={ChevronRight}
              >
                Replies (3)
              </Button>
              <Button
                chromeless
                color="$blue11"
                size="$1"
                theme="blue"
                icon={<ReplyArrow size={16} />}
              >
                Reply
              </Button>
            </XStack>
          </YStack>
        </XStack>
      </YStack>
    </YStack>
  )
}

function CommentDraft({docId}: {docId: UnpackedHypermediaId}) {
  const myAccountsQuery = useMyAccounts()
  const accounts = myAccountsQuery.map((query) => query.data).filter((a) => !!a)
  if (!accounts?.length) return null
  return <CommentDraftEditor docId={docId} accounts={accounts} />
}

function CommentDraftEditor({
  docId,
  accounts,
}: {
  docId: UnpackedHypermediaId
  accounts: HMEntityContent[]
}) {
  const {editor, onSubmit, onDiscard, isSaved, account, onSetAccount} =
    useCommentEditor(docId, accounts)
  return (
    <XStack
      padding="$4"
      borderRadius="$4"
      borderWidth={2}
      borderColor="$color8"
      minHeight={80}
    >
      <YStack
        f={1}
        onPress={() => {
          editor._tiptapEditor.commands.focus()
        }}
      >
        <AppDocContentProvider disableEmbedClick>
          <HMEditorContainer>
            <HyperMediaEditorView editor={editor} editable />
          </HMEditorContainer>
        </AppDocContentProvider>
        <XStack jc="flex-end" gap="$3" ai="center">
          <AutosaveIndicator isSaved={isSaved} />
          <SelectAccountDropdown
            accounts={accounts}
            account={account}
            onSetAccount={onSetAccount}
          />
          <Button size="$2" theme="blue" onPress={onSubmit} disabled={!isSaved}>
            Publish Comment
          </Button>
          <Tooltip content="Discard Comment Draft">
            <Button size="$2" onPress={onDiscard} theme="red" icon={Trash} />
          </Tooltip>
        </XStack>
      </YStack>
    </XStack>
  )
}

const autosaveIndicatorSize = 6
function AutosaveIndicator({isSaved}: {isSaved: StateStream<boolean>}) {
  const currentIsSaved = useStream(isSaved)
  return (
    <View
      backgroundColor={currentIsSaved ? '$colorTransparent' : '$yellow10'}
      width={autosaveIndicatorSize}
      height={autosaveIndicatorSize}
      borderRadius={autosaveIndicatorSize / 2}
    />
  )
}

function SelectAccountDropdown({
  account,
  onSetAccount,
  accounts,
}: {
  account: StateStream<string | null>
  onSetAccount: (account: string) => void
  accounts: HMEntityContent[]
}) {
  const currentAccount = useStream(account)
  const options = accounts.map((acct) => {
    return {
      label: getDocumentTitle(acct.document),
      value: acct.id.uid,
      icon: (
        <Thumbnail size={20} id={acct.id} metadata={acct.document?.metadata} />
      ),
    }
  })
  if (!options || !currentAccount) return null
  return (
    <SelectDropdown
      size="$2"
      options={options}
      value={currentAccount}
      onValue={onSetAccount}
    />
  )
}
