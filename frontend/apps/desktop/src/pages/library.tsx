import {dispatchWizardEvent} from '@/app-account'
import {useQueryInvalidator} from '@/app-context'
import {Avatar} from '@/components/avatar'
import {MainWrapper} from '@/components/main-wrapper'
import {useProfileWithDraft} from '@/models/accounts'
import {useDeleteKey, useMyAccountIds} from '@/models/daemon'
import {useDraftList} from '@/models/documents'
import {trpc} from '@/trpc'
import {getFileUrl} from '@/utils/account-url'
import {useOpenDraft} from '@/utils/open-draft'
import {useNavigate} from '@/utils/useNavigate'
import {createHmId, hmId} from '@shm/shared'
import {
  Add,
  Button,
  Container,
  Footer,
  List,
  PageHeading,
  SizableText,
  toast,
  View,
  XStack,
  YStack,
} from '@shm/ui'

export default function ContentPage() {
  const draftList = useDraftList()
  const openDraft = useOpenDraft('push')
  const keys = useMyAccountIds()
  const invalidate = useQueryInvalidator()
  const deleteDraft = trpc.drafts.delete.useMutation()

  function handleDelete(id: string) {
    deleteDraft.mutateAsync(id).then(() => {
      toast.success('Draft Deleted Successfully')
      invalidate(['trpc.drafts.list'])
      invalidate(['trpc.drafts.get', id])
    })
  }

  return (
    <>
      <MainWrapper>
        <Container>
          {keys.data?.length ? (
            <YStack>
              {keys.data.map((key) => (
                <AccountKeyItem accountId={key} key={key} />
              ))}
            </YStack>
          ) : (
            <Button onPress={() => dispatchWizardEvent(true)} icon={Add}>
              Add account
            </Button>
          )}
        </Container>
        <View height="100vh" alignSelf="stretch">
          <List
            items={draftList.data || []}
            fixedItemHeight={52}
            header={
              <Container>
                <PageHeading>Library</PageHeading>
              </Container>
            }
            footer={<View height={20} />}
            renderItem={({item}: {item: string}) => {
              if (!item) return <View height={1} />
              return (
                <XStack
                  paddingVertical="$1.5"
                  w="100%"
                  gap="$2"
                  ai="center"
                  paddingHorizontal="$4"
                  group="item"
                >
                  <SizableText
                    onPress={() => {
                      openDraft({id: item})
                    }}
                    fontWeight={'bold'}
                  >
                    Draft {item}
                  </SizableText>

                  <View f={1} />
                  <Button size="$2" onPress={() => handleDelete(item)}>
                    Delete
                  </Button>
                </XStack>
              )
            }}
          />
        </View>
      </MainWrapper>
      <Footer></Footer>
    </>
  )
}

function AccountKeyItem({accountId}: {accountId: string}) {
  const openDraft = useOpenDraft('push')
  const {draft, profile} = useProfileWithDraft(accountId)
  const deleteKey = useDeleteKey()
  const navigate = useNavigate('push')

  function openProfile() {
    navigate({
      key: 'document',
      id: hmId('a', accountId),
    })
  }
  const accountDraftId = createHmId('a', accountId)
  return (
    <XStack>
      <XStack f={1} ai="center" gap="$2">
        {profile?.metadata.thumbnail ? (
          <Avatar
            size={40}
            label={profile?.metadata.name}
            url={getFileUrl(profile.metadata.thumbnail)}
          />
        ) : null}
        <YStack f={1}>
          <p
            style={{
              display: 'block',
            }}
          >
            public key: {accountId.substring(accountId.length - 12)}
          </p>
        </YStack>
      </XStack>

      <Button
        size="$2"
        onPress={() => deleteKey.mutate({accountId: accountId})}
      >
        Delete Key
      </Button>
      {draft ? (
        <Button size="$2" onPress={() => openDraft({id: accountDraftId})}>
          Resume editing
        </Button>
      ) : (
        <Button size="$2" onPress={() => openDraft({id: accountDraftId})}>
          {profile ? 'Edit Profile' : 'Create Draft'}
        </Button>
      )}

      {profile ? (
        <Button size="$2" onPress={openProfile}>
          See Profile
        </Button>
      ) : null}
    </XStack>
  )
}
