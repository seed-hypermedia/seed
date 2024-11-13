import {FavoriteButton} from '@/components/favoriting'
import {MainWrapper} from '@/components/main-wrapper'
import {ListItemSkeleton} from '@/components/skeleton'
import {useListProfileDocuments} from '@/models/documents'
import {useEntities} from '@/models/entities'
import {useNavigate} from '@/utils/useNavigate'
import {PlainMessage} from '@bufbuild/protobuf'
import {DocumentListItem, getAccountName, hmId} from '@shm/shared'
import {
  Button,
  Container,
  getRandomColor,
  HMIcon,
  LinkIcon,
  SizableText,
  Spinner,
  Text,
  XStack,
  YStack,
} from '@shm/ui'
import {useMemo, useRef} from 'react'
import {useShowTitleObserver} from './app-title'

function ErrorPage({}: {error: any}) {
  // todo, this!
  return (
    <MainWrapper>
      <Container centered>
        <Text fontFamily="$body" fontSize="$3">
          Error
        </Text>
      </Container>
    </MainWrapper>
  )
}

export default function ContactsPage() {
  const contacts = useListProfileDocuments()
  const ref = useRef(null)
  useShowTitleObserver(ref.current)
  if (contacts.isLoading) {
    return (
      <>
        <MainWrapper>
          <Container centered>
            <Spinner />
          </Container>
        </MainWrapper>
      </>
    )
  }
  if (contacts.error) {
    return <ErrorPage error={contacts.error} />
  }

  return (
    <>
      <MainWrapper height="100%">
        <Container centered>
          <YStack paddingVertical="$4" marginHorizontal={-8}>
            {contacts.data?.length ? (
              contacts.data.map((contact) => (
                <ContactListItem entry={contact} />
              ))
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
    </>
  )
}

const hoverColor = '$color5'

function ContactListItem({entry}: {entry: PlainMessage<DocumentListItem>}) {
  const navigate = useNavigate()
  const id = hmId('d', entry.account, {
    version: entry.version,
  })

  const authors = useEntities(entry.authors.map((a) => hmId('d', a)))

  const editors = useMemo(
    () =>
      (authors.length == 1
        ? []
        : authors.length > 3
        ? authors.slice(0, 2)
        : authors
      ).filter((a) => !!a.data?.id.uid),
    [authors],
  )
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
          metadata={entry.metadata}
          borderRadius={40}
          color={getRandomColor(entry.account)}
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
              {getAccountName(entry)}
            </SizableText>
          </XStack>
        </YStack>
      </XStack>
      <XStack gap="$3" ai="center">
        <FavoriteButton id={id} hideUntilItemHover />
        <XStack>
          {editors.map((author, idx) => (
            <XStack
              zIndex={idx + 1}
              key={entry.account}
              borderColor="$background"
              backgroundColor="$background"
              $group-item-hover={{
                borderColor: hoverColor,
                backgroundColor: hoverColor,
              }}
              borderWidth={2}
              borderRadius={100}
              overflow="hidden"
              marginLeft={-8}
              animation="fast"
            >
              <LinkIcon
                key={author.data?.id.id}
                id={author.data?.id}
                metadata={author.data?.document?.metadata}
                size={20}
              />
            </XStack>
          ))}
          {entry.authors.length > editors.length && editors.length != 0 ? (
            <XStack
              zIndex="$zIndex.1"
              borderColor="$background"
              backgroundColor="$background"
              borderWidth={2}
              borderRadius={100}
              marginLeft={-8}
              animation="fast"
              width={24}
              height={24}
              ai="center"
              jc="center"
            >
              <Text
                fontSize={10}
                fontFamily="$body"
                fontWeight="bold"
                color="$color10"
              >
                +{entry.authors.length - editors.length - 1}
              </Text>
            </XStack>
          ) : null}
        </XStack>
      </XStack>
    </Button>
  )
}
