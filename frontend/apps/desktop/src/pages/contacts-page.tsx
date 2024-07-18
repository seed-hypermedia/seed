import {Avatar} from '@/components/avatar'
import {FavoriteButton} from '@/components/favoriting'
import Footer from '@/components/footer'
import {OnlineIndicator} from '@/components/indicator'
import {ListItem, copyLinkMenuItem} from '@/components/list-item'
import {MainWrapper, MainWrapperNoScroll} from '@/components/main-wrapper'
import {MenuItemType} from '@/components/options-dropdown'
import {useAccountIsConnected} from '@/models/accounts'
import {useListProfileDocuments} from '@/models/documents'
import {useFavorite} from '@/models/favorites'
import {useGatewayUrl} from '@/models/gateway-settings'
import {getFileUrl} from '@/utils/account-url'
import {DocumentRoute} from '@/utils/routes'
import {useNavigate} from '@/utils/useNavigate'
import {HMAccount, createHmId, hmId} from '@shm/shared'
import {
  ArrowUpRight,
  Container,
  List,
  PageHeading,
  Spinner,
  Text,
  XStack,
  YStack,
} from '@shm/ui'
import {Trash} from '@tamagui/lucide-icons'
import {useRef} from 'react'
import {useShowTitleObserver} from './app-title'

export function ContactItem({
  account,
  onCopy,
  onDelete,
}: {
  account: HMAccount
  onCopy: () => void
  onDelete?: (input: {id: string; title?: string}) => void
}) {
  const navigate = useNavigate()
  const spawn = useNavigate('spawn')
  const isConnected = useAccountIsConnected(account)
  const accountUrl = account.id ? createHmId('a', account.id) : undefined
  const favorite = useFavorite(accountUrl)
  const alias = account.profile?.alias
  const gwUrl = useGatewayUrl()
  const accountId = account.id
  if (!accountId) throw new Error('Account ID is required')
  const openRoute: DocumentRoute = {key: 'document', id: hmId('a', accountId)}
  const menuItems: (MenuItemType | null)[] = [
    {
      key: 'spawn',
      label: 'Open in New Window',
      icon: ArrowUpRight,
      onPress: () => {
        spawn(openRoute)
      },
    },
    copyLinkMenuItem(
      onCopy,
      account.profile?.alias ? `${account.profile.alias}'s Profile` : `Profile`,
    ),
  ]
  if (onDelete) {
    menuItems.push({
      key: 'delete',
      label: 'Delete Account',
      icon: Trash,
      onPress: () => {
        onDelete({
          id: createHmId('a', accountId),
          title: account.profile?.alias,
        })
      },
    })
  }
  return (
    <ListItem
      icon={
        <Avatar
          size={24}
          id={account.id}
          label={account.profile?.alias}
          url={getFileUrl(account.profile?.avatar)}
        />
      }
      onPress={() => {
        navigate(openRoute)
      }}
      title={alias || accountId.slice(0, 5) + '...' + accountId.slice(-5)}
      accessory={
        <>
          {accountUrl && (
            <XStack
              opacity={favorite.isFavorited ? 1 : 0}
              $group-item-hover={
                favorite.isFavorited ? undefined : {opacity: 1}
              }
            >
              <FavoriteButton url={accountUrl} />
            </XStack>
          )}
          <OnlineIndicator online={isConnected} />
        </>
      }
      menuItems={menuItems}
    />
  )
}

function ErrorPage({}: {error: any}) {
  // todo, this!
  return (
    <MainWrapper>
      <Container>
        <Text fontFamily="$body" fontSize="$3">
          Error
        </Text>
      </Container>
    </MainWrapper>
  )
}

export default function ContactsPage() {
  const contacts = useListProfileDocuments()
  const navigate = useNavigate('push')
  const ref = useRef(null)
  useShowTitleObserver(ref.current)
  if (contacts.isLoading) {
    return (
      <MainWrapper>
        <Container>
          <Spinner />
        </Container>
      </MainWrapper>
    )
  }
  if (contacts.error) {
    return <ErrorPage error={contacts.error} />
  }
  if (contacts.data?.documents.length === 0) {
    return (
      <>
        <MainWrapper>
          <Container>
            <YStack gap="$5" paddingVertical="$8">
              <Text fontFamily="$body" fontSize="$3">
                You have no Contacts yet.
              </Text>
            </YStack>
          </Container>
        </MainWrapper>
        <Footer />
      </>
    )
  }
  return (
    <>
      <MainWrapperNoScroll>
        <List
          header={
            <Container>
              <PageHeading ref={ref}>Contacts</PageHeading>
            </Container>
          }
          items={contacts.data!.documents}
          renderItem={({item}) => {
            return (
              <ListItem
                title={item.metadata.name}
                icon={
                  <Avatar
                    url={item.metadata.thumbnail}
                    label={item.metadata.name}
                    size={24}
                  />
                }
                onPress={() => {
                  navigate({
                    key: 'document',
                    id: item.id,
                  })
                }}
              />
            )
          }}
        />
      </MainWrapperNoScroll>
      {/* {copyDialogContent}
      {deleteEntity.content} */}
      <Footer />
    </>
  )
}
