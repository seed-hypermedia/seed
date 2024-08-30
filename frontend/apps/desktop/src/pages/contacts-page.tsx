import {FavoriteButton} from '@/components/favoriting'
import Footer from '@/components/footer'
import {MainWrapper} from '@/components/main-wrapper'
import {useListProfileDocuments} from '@/models/documents'
import {useEntities} from '@/models/entities'
import {useNavigate} from '@/utils/useNavigate'
import {PlainMessage} from '@bufbuild/protobuf'
import {DocumentListItem, getMetadataName, hmId} from '@shm/shared'
import {
  Button,
  Container,
  getRandomColor,
  LinkThumbnail,
  SizableText,
  Spinner,
  Text,
  Thumbnail,
  XStack,
  YStack,
} from '@shm/ui'
import {useMemo, useRef} from 'react'
import {useShowTitleObserver} from './app-title'

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
  if (!contacts.data?.length) {
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
      <MainWrapper>
        <Container>
          <YStack paddingVertical="$4" marginHorizontal={-8}>
            {contacts.data.map((contact) => (
              <ContactListItem entry={contact} />
            ))}
          </YStack>
        </Container>
      </MainWrapper>
      {/* {copyDialogContent}
      {deleteEntity.content} */}
      <Footer />
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
        <Thumbnail
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
          <XStack ai="center" gap="$2" paddingLeft={4}>
            <SizableText
              fontWeight="bold"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
              overflow="hidden"
            >
              {getMetadataName(entry.metadata) ||
                `${entry.account.slice(0, 5)}...${entry.account.slice(-5)}`}
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
              <LinkThumbnail
                key={author.data?.id.id}
                id={author.data?.id}
                metadata={author.data?.document?.metadata}
                size={20}
              />
            </XStack>
          ))}
          {entry.authors.length > editors.length && editors.length != 0 ? (
            <XStack
              zIndex={editors.length}
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
