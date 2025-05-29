import {FavoriteButton} from '@/components/favoriting'
import {MainWrapper} from '@/components/main-wrapper'
import {useAllAccountsWithContacts} from '@/models/contacts'
import {useNavigate} from '@/utils/useNavigate'
import {getMetadataName} from '@shm/shared/content'
import {HMAccount} from '@shm/shared/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {Container, PanelContainer} from '@shm/ui/container'
import {ListItemSkeleton} from '@shm/ui/entity-card'
import {HMIcon} from '@shm/ui/hm-icon'
import {Spinner} from '@shm/ui/spinner'
import {SizableText, Text} from '@shm/ui/text'
import {XStack, YStack} from 'tamagui'

function ErrorPage({}: {error: any}) {
  // todo, this!
  return (
    <PanelContainer>
      <MainWrapper scrollable>
        <Container centered>
          <Text className="font-body text-md">Error</Text>
        </Container>
      </MainWrapper>
    </PanelContainer>
  )
}

export default function ContactsPage() {
  const allAccounts = useAllAccountsWithContacts()
  if (allAccounts.isLoading) {
    return (
      <PanelContainer>
        <MainWrapper scrollable>
          <div className="flex items-center justify-center p-6">
            <Spinner />
          </div>
        </MainWrapper>
      </PanelContainer>
    )
  }
  if (allAccounts.error) {
    return <ErrorPage error={allAccounts.error} />
  }

  return (
    <PanelContainer>
      <MainWrapper scrollable>
        <Container centered>
          <YStack paddingVertical="$4" marginHorizontal={-8}>
            {allAccounts.data?.length ? (
              allAccounts.data.map((account) => {
                if (account.aliasAccount) return null
                return (
                  <ContactListItem
                    key={account.id}
                    account={account}
                    // accountsMetadata={accounts.data.accountsMetadata}
                  />
                )
              })
            ) : (
              <YStack gap="$3">
                {[...Array(5)].map((_, index) => (
                  <ListItemSkeleton key={index} />
                ))}
                <XStack jc="center" ai="center" f={1} gap="$2">
                  <SizableText color="muted">No contacts yet...</SizableText>
                  {/* <Button size="$2">Add a Connection</Button> */}
                </XStack>
              </YStack>
            )}
          </YStack>
        </Container>
      </MainWrapper>
    </PanelContainer>
  )
}

const hoverColor = '$color5'

function ContactListItem({account}: {account: HMAccount}) {
  const navigate = useNavigate()
  const id = hmId('d', account.id, {})
  return (
    <Button
      group="item"
      borderWidth={0}
      bg="$colorTransparent"
      hoverStyle={{
        bg: hoverColor,
      }}
      paddingHorizontal={16}
      paddingVertical="$1"
      onPress={() => {
        navigate({key: 'contact', id})
      }}
      h={60}
      icon={
        <HMIcon
          size={28}
          id={id}
          metadata={account.metadata}
          borderRadius={40}
        />
      }
    >
      <XStack gap="$2" ai="center" f={1} paddingVertical="$2">
        <YStack f={1} gap="$1.5">
          <XStack ai="center" gap="$2">
            <SizableText
              weight="bold"
              className="overflow-hidden truncate whitespace-nowrap"
            >
              {getMetadataName(account.metadata)}
            </SizableText>
          </XStack>
        </YStack>
      </XStack>
      <XStack gap="$3" ai="center">
        <FavoriteButton id={id} hideUntilItemHover />
      </XStack>
    </Button>
  )
}
