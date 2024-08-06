import {openAddAccountWizard} from '@/components/create-account'
import {MainWrapper} from '@/components/main-wrapper'
import {Thumbnail} from '@/components/thumbnail'
import {useDraft} from '@/models/accounts'
import {useDeleteKey, useMyAccountIds} from '@/models/daemon'
import {useDeleteDraft, useDraftList} from '@/models/documents'
import {useEntity} from '@/models/entities'
import {useOpenDraft} from '@/utils/open-draft'
import {useNavigate} from '@/utils/useNavigate'
import {hmId, unpackHmId} from '@shm/shared'
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
  const deleteDraft = useDeleteDraft()
  function handleDelete(id: string) {
    deleteDraft.mutateAsync(id).then(() => {
      toast.success('Draft Deleted Successfully')
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
          ) : null}
          <Button onPress={() => openAddAccountWizard()} icon={Add}>
            Add account
          </Button>
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
              const id = unpackHmId(item)
              if (!id) return null
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
                      openDraft({id})
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
  const id = hmId('d', accountId)
  const draft = useDraft(id.id)
  const doc = useEntity(id)
  const deleteKey = useDeleteKey()
  const navigate = useNavigate('push')

  function openProfile() {
    navigate({
      key: 'document',
      id,
    })
  }
  const accountDraftId = hmId('d', accountId)
  return (
    <XStack>
      <XStack f={1} ai="center" gap="$2">
        <Thumbnail id={id} document={doc.data?.document} size={40} />
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
      {draft.data ? (
        <Button size="$2" onPress={() => openDraft({id: accountDraftId})}>
          Resume editing
        </Button>
      ) : (
        <Button size="$2" onPress={() => openDraft({id: accountDraftId})}>
          {doc.data ? 'Edit Profile' : 'Create Draft'}
        </Button>
      )}

      {doc.data ? (
        <Button size="$2" onPress={openProfile}>
          See Profile
        </Button>
      ) : null}
    </XStack>
  )
}
