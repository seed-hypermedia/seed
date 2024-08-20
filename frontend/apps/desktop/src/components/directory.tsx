import {ImportButton} from '@/components/import-doc-button'
import {useMyCapability} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {
  HMDocumentListItem,
  useDraftList,
  useListDirectory,
} from '@/models/documents'
import {useEntities} from '@/models/entities'
import {pathNameify} from '@/utils/path'
import {useNavigate} from '@/utils/useNavigate'
import {
  formattedDate,
  formattedDateLong,
  formattedDateMedium,
  getMetadataName,
  HMDocument,
  hmId,
  packHmId,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {Button, SizableText, Text, Tooltip, XStack, YStack} from '@shm/ui'
import {Copy, FilePlus, Pencil} from '@tamagui/lucide-icons'
import {nanoid} from 'nanoid'
import {useMemo} from 'react'
import {FavoriteButton} from './favoriting'
import {LinkThumbnail, Thumbnail} from './thumbnail'

export function Directory({docId}: {docId: UnpackedHypermediaId}) {
  const dir = useListDirectory(docId)
  const backendDrafts = useDraftList()

  const {drafts, directory} = useMemo(() => {
    let draftsForShow = backendDrafts.data || []
    return {
      directory: dir.data
        ? dir.data
            .filter((item) => {
              const level = docId.path?.length || 0
              if (item.path.length !== level + 1) return false
              let pathPrefix = (docId.path || []).join('/')
              return item.path.join('/').startsWith(pathPrefix)
            })
            .map((dirItem) => {
              const id = hmId(docId.type, docId.uid, {
                path: dirItem.path,
              })
              const hasDraft = draftsForShow?.includes(id.id)
              if (hasDraft) {
                draftsForShow = draftsForShow?.filter(
                  (draftId) => draftId !== id.id,
                )
              }
              return {
                ...dirItem,
                id,
                hasDraft,
              }
            })
        : [],
      drafts: draftsForShow
        ?.map((draftId) => {
          const id = unpackHmId(draftId)
          if (!id) return null
          return id
        })
        .filter((id) => {
          if (!id) return false
          if (id.uid != docId.uid) return false
          const level = docId.path?.length || 0
          if (id.path?.length !== level + 1) return false
          let pathPrefix = (docId.path || []).join('/')
          return id.path.join('/').startsWith(pathPrefix)
        }),
    }
  }, [dir.data, backendDrafts.data])

  return (
    <YStack paddingVertical="$4">
      {drafts.map((id) => {
        if (!id) return null
        return <DraftListItem key={id.id} id={id} />
      })}

      {directory.map((item) => (
        <DirectoryItem key={item.id.id} entry={item} />
      ))}

      <DocCreation id={docId} />
    </YStack>
  )
}

function DocCreation({id}: {id: UnpackedHypermediaId}) {
  const capability = useMyCapability(id)
  if (!capability) return null
  return (
    <XStack paddingVertical="$4" gap="$3">
      <NewSubDocumentButton parentDocId={id} />
      <ImportButton input={id} />
    </XStack>
  )
}

function DraftListItem({id}: {id: UnpackedHypermediaId}) {
  const navigate = useNavigate()

  const draft = useDraft(packHmId(id))

  function goToDraft() {
    navigate({key: 'draft', id})
  }

  return (
    <Button
      group="item"
      borderWidth={0}
      hoverStyle={{
        bg: itemHoverBgColor,
      }}
      w="100%"
      paddingHorizontal={16}
      paddingVertical="$1"
      onPress={goToDraft}
      h={60}
      icon={
        draft.data?.metadata.thumbnail ? (
          <Thumbnail size={40} id={id} metadata={draft.data.metadata} />
        ) : undefined
      }
    >
      <XStack gap="$2" ai="center" f={1} paddingVertical="$2">
        <YStack f={1} gap="$1.5">
          <XStack ai="center" gap="$2" paddingLeft={4} f={1} w="100%">
            <SizableText
              fontWeight="bold"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
              overflow="hidden"
            >
              {draft.data?.metadata.name || 'Untitled'}
            </SizableText>
            <SizableText
              size="$1"
              color="$yellow11"
              paddingHorizontal="$2"
              paddingVertical="$1"
              bg="$yellow3"
              borderRadius="$1"
              borderColor="$yellow10"
              borderWidth={1}
            >
              DRAFT
            </SizableText>
          </XStack>
          <PathButton path={id.path} onCopy={() => {}} />
        </YStack>
      </XStack>
      <XStack gap="$3" ai="center">
        {/* <Button theme="yellow" icon={Pencil} size="$2">
          Resume Editing
        </Button> */}
        {draft.data?.lastUpdateTime ? (
          <Tooltip
            content={`Last update: ${formattedDateLong(
              new Date(draft.data.lastUpdateTime),
            )}`}
          >
            <SizableText size="$1">
              {formattedDateMedium(new Date(draft.data.lastUpdateTime))}
            </SizableText>
          </Tooltip>
        ) : null}

        {/* <XStack>
          <DocumentEditors entry={id} />
        </XStack> */}
      </XStack>
    </Button>
  )
}

const itemHoverBgColor = '$color5'

// TODO: update types
function DirectoryItem({
  entry,
}: {
  entry: HMDocumentListItem & {id: UnpackedHypermediaId; hasDraft: boolean}
}) {
  const navigate = useNavigate()
  const metadata = entry?.metadata
  return (
    <Button
      group="item"
      borderWidth={0}
      hoverStyle={{
        bg: itemHoverBgColor,
      }}
      w="100%"
      paddingHorizontal={16}
      paddingVertical="$1"
      onPress={() => {
        navigate({key: 'document', id: entry.id})
      }}
      h={60}
      icon={
        entry.metadata.thumbnail ? (
          <Thumbnail size={40} id={entry.id} metadata={entry.metadata} />
        ) : undefined
      }
    >
      <XStack gap="$2" ai="center" f={1} paddingVertical="$2">
        <YStack f={1} gap="$1.5">
          <XStack ai="center" gap="$2" paddingLeft={4} f={1} w="100%">
            <SizableText
              fontWeight="bold"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
              overflow="hidden"
            >
              {getMetadataName(metadata)}
            </SizableText>
          </XStack>
          <PathButton path={entry.path} onCopy={() => {}} />
        </YStack>
      </XStack>
      <XStack gap="$3" ai="center">
        <FavoriteButton id={entry.id} hideUntilItemHover />

        {entry.hasDraft ? (
          <Button
            theme="yellow"
            icon={Pencil}
            size="$2"
            onPress={(e: MouseEvent) => {
              e.stopPropagation()
              navigate({key: 'draft', id: entry.id})
            }}
          >
            Resume Editing
          </Button>
        ) : (
          <SizableText size="$1">{formattedDate(entry.updateTime)}</SizableText>
        )}
        <XStack>
          <DocumentEditors entry={entry} />
        </XStack>
      </XStack>
    </Button>
  )
}

function DocumentEditors({
  entry,
}: {
  entry: HMDocumentListItem & {id: UnpackedHypermediaId; hasDraft?: boolean}
}) {
  const editorIds = useMemo(
    () =>
      entry.authors.length > 3 ? entry.authors.slice(0, 2) : entry.authors,
    [entry.authors],
  )
  const editors = useEntities(editorIds.map((id) => hmId('d', id)))
  return (
    <>
      {/* todo add author data here */}
      {editors.map((author, idx) =>
        author.data?.id ? (
          <XStack
            zIndex={idx + 1}
            key={editorIds[idx]}
            borderColor="$background"
            backgroundColor="$background"
            $group-item-hover={{
              borderColor: itemHoverBgColor,
              backgroundColor: itemHoverBgColor,
            }}
            borderWidth={2}
            borderRadius={100}
            overflow="hidden"
            marginLeft={-8}
            animation="fast"
          >
            <LinkThumbnail
              key={author.data?.id.id}
              id={author.data?.id!}
              metadata={author.data?.document?.metadata}
              size={20}
            />
          </XStack>
        ) : null,
      )}
      {entry.authors.length > editors.length ? (
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
    </>
  )
}

function NewSubDocumentButton({
  parentDocId,
}: {
  parentDocId: UnpackedHypermediaId
}) {
  const navigate = useNavigate('push')
  return (
    <>
      <Button
        icon={FilePlus}
        onPress={() => {
          const id = {
            ...parentDocId,
            path: [...(parentDocId.path || []), `_${pathNameify(nanoid(10))}`],
          }
          console.log(`== ~ id:`, id)
          navigate({
            key: 'draft',
            id,
          })
        }}
        size="$3"
      >
        Create Document
      </Button>
    </>
  )
}

function PathButton({
  path,
  onCopy,
}: {
  path: UnpackedHypermediaId['path'] | HMDocument['path']
  onCopy: () => void
}) {
  return (
    <XStack
      group="pathitem"
      alignSelf="flex-start"
      ai="center"
      gap="$2"
      onPress={(e: MouseEvent) => {
        onCopy()
        e.stopPropagation()
        e.preventDefault()
      }}
    >
      <SizableText
        color="$blue8"
        size="$1"
        $group-pathitem-hover={{
          color: '$blue11',
        }}
        textOverflow="ellipsis"
        whiteSpace="nowrap"
        overflow="hidden"
        hoverStyle={{
          color: '$blue10',
        }}
      >
        {path ? `/${path.at(-1)}` : ''}
      </SizableText>
      <Copy
        flexGrow={0}
        flexShrink={0}
        size={12}
        color="$blue10"
        opacity={0}
        $group-pathitem-hover={{
          opacity: 1,
        }}
      />
    </XStack>
  )
}
