import {MainWrapper} from '@/components/main-wrapper'
import {useDraftList} from '@/models/documents'
import {useNavigate} from '@/utils/useNavigate'
import {getMetadataName, HMListedDraft} from '@shm/shared'
import {Container} from '@shm/ui/container'
import {Button, SizableText, XStack, YStack} from 'tamagui'

export default function DraftsPage() {
  const drafts = useDraftList()

  console.log(`== ~ DraftsPage ~ drafts:`, drafts)
  // console.log(drafts.data)
  return (
    <XStack flex={1} height="100%">
      <MainWrapper>
        <Container justifyContent="center" centered>
          {drafts.data?.map((item) => {
            return <DraftItem item={item} key={item.id} />
          })}
        </Container>
      </MainWrapper>
    </XStack>
  )
}

export function DraftItem({item}: {item: HMListedDraft}) {
  const navigate = useNavigate()
  const metadata = item?.metadata
  return (
    <Button
      group="item"
      borderWidth={0}
      hoverStyle={{
        bg: '$color5',
      }}
      bg="$backgroundStrong"
      // elevation="$1"
      paddingHorizontal={16}
      paddingVertical="$2"
      onPress={() => {
        navigate({key: 'draft', id: item.id})
      }}
      h="auto"
      marginVertical={'$1'}
      ai="center"
    >
      <YStack f={1}>
        {/* <LibraryEntryBreadcrumbs
          breadcrumbs={item.breadcrumbs}
          onNavigate={navigate}
          id={id}
        /> */}
        <XStack gap="$3" ai="center">
          <SizableText
            f={1}
            fontWeight={'bold'}
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            overflow="hidden"
          >
            {getMetadataName(metadata)}
          </SizableText>
          {/* <LibraryEntryAuthors
            item={item}
            accountsMetadata={accountsMetadata}
          /> */}
        </XStack>
      </YStack>
    </Button>
  )
}
