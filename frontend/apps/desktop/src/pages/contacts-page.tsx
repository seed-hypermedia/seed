import {FavoriteButton} from '@/components/favoriting'
import {MainWrapper} from '@/components/main-wrapper'
import {useAccountList} from '@/models/accounts'
import {useNavigate} from '@/utils/useNavigate'
import {getMetadataName} from '@shm/shared/content'
import {HMAccount, HMAccountsMetadata} from '@shm/shared/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {Container, PanelContainer} from '@shm/ui/container'
import {ListItemSkeleton} from '@shm/ui/entity-card'
import {HMIcon} from '@shm/ui/hm-icon'
import {Spinner} from '@shm/ui/spinner'
import {useRef} from 'react'
import {SizableText, Text, XStack, YStack} from 'tamagui'
import {useShowTitleObserver} from './app-title'

function ErrorPage({}: {error: any}) {
  // todo, this!
  return (
    <PanelContainer>
      <MainWrapper scrollable>
        <Container centered>
          <Text fontFamily="$body" fontSize="$3">
            Error
          </Text>
        </Container>
      </MainWrapper>
    </PanelContainer>
  )
}

export default function ContactsPage() {
  const accounts = useAccountList()
  const ref = useRef(null)
  useShowTitleObserver(ref.current)
  if (accounts.isLoading) {
    return (
      <PanelContainer>
        <MainWrapper scrollable>
          <div className="flex justify-center items-center p-6">
            <Spinner />
          </div>
        </MainWrapper>
      </PanelContainer>
    )
  }
  if (accounts.error) {
    return <ErrorPage error={accounts.error} />
  }

  return (
    <PanelContainer>
      <MainWrapper scrollable>
        <Container centered>
          <YStack paddingVertical="$4" marginHorizontal={-8}>
            {accounts.data?.accounts.length ? (
              accounts.data.accounts.map((account) => {
                if (account.aliasAccount) return null
                return (
                  <ContactListItem
                    key={account.id}
                    account={account}
                    accountsMetadata={accounts.data.accountsMetadata}
                  />
                )
              })
            ) : (
              <YStack gap="$3">
                {[...Array(5)].map((_, index) => (
                  <ListItemSkeleton key={index} />
                ))}
                <XStack jc="center" ai="center" f={1} gap="$2">
                  <SizableText color="$color10">No contacts yet...</SizableText>
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

function ContactListItem({
  account,
  accountsMetadata,
}: {
  account: HMAccount
  accountsMetadata: HMAccountsMetadata
}) {
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
        navigate({key: 'document', id})
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
              fontWeight="bold"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
              overflow="hidden"
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
