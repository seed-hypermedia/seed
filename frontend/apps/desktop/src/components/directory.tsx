import {useDraft} from '@/models/accounts'
import {useDraftList, useListDirectory} from '@/models/documents'
import {useEntities, useSubscribedEntity} from '@/models/entities'
import {pathNameify} from '@/utils/path'
import {useNavigate} from '@/utils/useNavigate'
import {
  formattedDateLong,
  formattedDateMedium,
  getMetadataName,
  hmId,
  HMMetadata,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {
  Button,
  DirectoryItem,
  HMIcon,
  itemHoverBgColor,
  SizableText,
  SmallListItem,
  Tooltip,
  XStack,
  YStack,
} from '@shm/ui'
import {Copy} from '@tamagui/lucide-icons'
import {useMemo} from 'react'
import {CopyReferenceButton} from './titlebar-common'

export function Directory({
  docId,
  indented,
}: {
  docId: UnpackedHypermediaId
  indented?: number
}) {
  const dir = useListDirectory(docId)
  useSubscribedEntity(docId, true)
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
                metadata: dirItem.metadata,
                path: dirItem.path.join('/'),
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
  const navigate = useNavigate()
  return (
    <>
      {drafts.map((id) => {
        if (!id) return null
        // return <DraftItem key={id.id} id={id} />
        return <DraftItem id={id} key={id.id} indented={indented} />
        // return <SmallListItem key={id.id} title="Draft" icon={<Plus />} right={<DraftTag />} />
      })}

      {/* {directory.map((item) => (
        <DirectoryItemWithAuthors key={item.id.id} entry={item} />
      ))} */}

      {directory.map((item) => (
        <SmallListItem
          onPress={() => {
            navigate({key: 'document', id: item.id})
          }}
          title={getMetadataName(item.metadata)}
          key={item.id.id}
          icon={<HMIcon id={item.id} metadata={item.metadata} size={20} />}
          indented={indented}
        />
      ))}
    </>
  )
}

function DraftTag() {
  return (
    <SizableText
      size="$1"
      color="$yellow11"
      paddingHorizontal={4}
      paddingVertical={8}
      lineHeight={1}
      fontSize={10}
      bg="$yellow3"
      borderRadius="$1"
      borderColor="$yellow10"
      borderWidth={1}
    >
      DRAFT
    </SizableText>
  )
}

function DraftItem({
  id,
  indented,
}: {
  id: UnpackedHypermediaId
  indented?: number
}) {
  const navigate = useNavigate()

  const draft = useDraft(id)
  function goToDraft() {
    navigate({key: 'draft', id})
  }
  return (
    <SmallListItem
      key={id.id}
      title={draft.data?.metadata.name || 'Untitled'}
      icon={<HMIcon size={20} id={id} metadata={draft.data?.metadata} />}
      indented={indented}
      iconAfter={<DraftTag />}
      onPress={goToDraft}
    />
  )
}
function DraftItemLarge({id}: {id: UnpackedHypermediaId}) {
  const navigate = useNavigate()

  const draft = useDraft(id)
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
        draft.data?.metadata.icon ? (
          <HMIcon size={28} id={id} metadata={draft.data.metadata} />
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
            <DraftTag />
          </XStack>
          <PathButton
            docId={id}
            isDraft
            path={
              !!draft.data?.metadata?.name &&
              id.path &&
              id.path.at(-1)?.startsWith('_')
                ? `${pathNameify(draft.data.metadata.name)}`
                : id.path
                ? `${id.path.at(-1)}`
                : ''
            }
          />
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

function DirectoryItemWithAuthors({
  entry,
}: {
  entry: {
    id: UnpackedHypermediaId
    hasDraft?: boolean
    authors: string[]
    path: string
    metadata: HMMetadata
  }
}) {
  const editorIds = useMemo(
    () =>
      entry.authors.length > 3 ? entry.authors.slice(0, 2) : entry.authors,
    [entry.authors],
  )
  const editors = useEntities(editorIds.map((id) => hmId('d', id)))
  const authorsMetadata = editors
    .map((query) => query.data)
    .filter((author) => !!author)
    .map((data) => {
      return {
        id: data!.id!,
        metadata: data?.document?.metadata,
      }
    })
  return (
    <DirectoryItem
      PathButtonComponent={PathButton}
      entry={entry}
      authorsMetadata={authorsMetadata}
    />
  )
}

function PathButton({
  path,
  docId,
  isDraft = false,
}: {
  path: string
  docId: UnpackedHypermediaId
  isDraft?: boolean
}) {
  const Comp = !isDraft ? CopyReferenceButton : XStack
  return (
    <Comp
      isBlockFocused={false}
      docId={docId}
      alignSelf="flex-start"
      ai="center"
      group="item"
      // gap="$2"
      bg="$colorTransparent"
      borderColor="$colorTransparent"
      borderWidth={0}
      size="$1"
      maxWidth="100%"
      overflow="hidden"
      copyIcon={Copy}
      iconPosition="after"
      showIconOnHover
    >
      <SizableText
        color="$brand5"
        size="$1"
        $group-item-hover={
          isDraft
            ? undefined
            : {
                color: '$brand6',
                textDecorationLine: 'underline',
              }
        }
        textOverflow="ellipsis"
        whiteSpace="nowrap"
        overflow="hidden"
      >
        {path}
      </SizableText>
    </Comp>
  )
}
