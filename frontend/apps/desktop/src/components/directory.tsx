import {ImportButton} from '@/components/import-doc-button'
import {useMyCapability} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {useDraftList, useListDirectory} from '@/models/documents'
import {useEntities} from '@/models/entities'
import {pathNameify} from '@/utils/path'
import {useNavigate} from '@/utils/useNavigate'
import {
  formattedDateLong,
  formattedDateMedium,
  hmId,
  HMMetadata,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {
  Button,
  DirectoryItem,
  itemHoverBgColor,
  SizableText,
  Thumbnail,
  Tooltip,
  XStack,
  YStack,
} from '@shm/ui'
import {FilePlus} from '@tamagui/lucide-icons'
import {nanoid} from 'nanoid'
import {useMemo} from 'react'
import {CopyReferenceButton} from './titlebar-common'

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

  return (
    <YStack paddingVertical="$4">
      {drafts.map((id) => {
        if (!id) return null
        return <DraftItem key={id.id} id={id} />
      })}

      {directory.map((item) => (
        <DirectoryItemWithAuthors key={item.id.id} entry={item} />
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

function DraftItem({id}: {id: UnpackedHypermediaId}) {
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
        draft.data?.metadata.thumbnail ? (
          <Thumbnail size={28} id={id} metadata={draft.data.metadata} />
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
          </XStack>
          <PathButton
            isDraft
            path={
              !!draft.data?.metadata?.name &&
              id.path &&
              id.path.at(-1)?.startsWith('_')
                ? `/${pathNameify(draft.data.metadata.name)}`
                : id.path
                ? `/${id.path.at(-1)}`
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
        uid: data!.id!.uid,
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
          const id = hmId('d', parentDocId.uid, {
            path: [...(parentDocId.path || []), `_${pathNameify(nanoid(10))}`],
          })
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
  docId,
  isDraft = false,
}: {
  path: string
  docId: UnpackedHypermediaId
  isDraft?: boolean
}) {
  const Comp = !isDraft ? CopyReferenceButton : XStack
  return (
    // <CopyReferenceButton docId={docId} isBlockFocused={false}>
    <Comp
      docId={docId}
      group="pathitem"
      alignSelf="flex-start"
      ai="center"
      // gap="$2"
      bg="$colorTransparent"
      borderColor="$colorTransparent"
      borderWidth={0}
      size="$1"
      maxWidth="100%"
      overflow="hidden"
      isIconAfter
    >
      <SizableText
        color="$brand5"
        size="$1"
        $group-pathitem-hover={
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
