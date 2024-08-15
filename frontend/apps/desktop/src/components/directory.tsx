import {ImportButton} from '@/components/import-doc-button'
import {useMyCapability} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {useDraftList, useListDirectory} from '@/models/documents'
import {pathNameify} from '@/utils/path'
import {useNavigate} from '@/utils/useNavigate'
import {
  formattedDate,
  formattedDateLong,
  HMDocument,
  hmId,
  packHmId,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {Button, DataTable, SizableText, Tooltip, XStack, YStack} from '@shm/ui'
import {Copy, FilePlus} from '@tamagui/lucide-icons'
import {nanoid} from 'nanoid'
import {useMemo} from 'react'
import {Thumbnail} from './thumbnail'

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
          const level = docId.path?.length || 0
          if (id.path?.length !== level + 1) return false
          let pathPrefix = (docId.path || []).join('/')
          return id.path.join('/').startsWith(pathPrefix)
        }),
    }
  }, [dir.data, backendDrafts.data])

  return (
    <YStack paddingVertical="$4">
      <DataTable.Root
        style={
          {
            // tableLayout: 'fixed',
          }
        }
      >
        <DataTable.Head>
          <DataTable.Row borderBottomWidth={10}>
            <DataTable.HeaderCell width="50%">
              <SizableText size="$1" f={1} textAlign="left">
                Document name
              </SizableText>
            </DataTable.HeaderCell>
            <DataTable.HeaderCell>
              <SizableText size="$1" f={1} textAlign="left">
                Path
              </SizableText>
            </DataTable.HeaderCell>
            <DataTable.HeaderCell>
              <SizableText size="$1" f={1} textAlign="left">
                Last update
              </SizableText>
            </DataTable.HeaderCell>
            <DataTable.HeaderCell>
              <SizableText size="$1" f={1} textAlign="left">
                Authors
              </SizableText>
            </DataTable.HeaderCell>
          </DataTable.Row>
        </DataTable.Head>
        <DataTable.Body>
          {drafts.length ? (
            <DataTable.Row bg="$color5">
              <DataTable.Cell colSpan={4}>
                <SizableText size="$1" color="$color9" fontWeight="600">
                  Drafts
                </SizableText>
              </DataTable.Cell>
            </DataTable.Row>
          ) : null}
          {drafts.map((id) => {
            if (!id) return null
            return <DraftListItem key={id.id} id={id} />
          })}
          {drafts.length && directory.length ? (
            <DataTable.Row bg="$color5">
              <DataTable.Cell colSpan={4}>
                <SizableText size="$1" color="$color9" fontWeight="600">
                  Documents
                </SizableText>
              </DataTable.Cell>
            </DataTable.Row>
          ) : null}
          {directory.map((item) => (
            <DirectoryItem item={item} />
          ))}
        </DataTable.Body>
      </DataTable.Root>
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
    <DataTable.Row>
      <DataTable.Cell onPress={goToDraft}>
        <XStack gap="$2">
          <Thumbnail size={20} id={id} metadata={draft.data?.metadata} />
          <SizableText
            fontWeight="600"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            overflow="hidden"
          >
            {draft.data?.metadata.name || 'Untitled'}
          </SizableText>
        </XStack>
      </DataTable.Cell>
      <DataTable.Cell onPress={goToDraft}>
        <PathButton path={id.path || []} onCopy={() => {}} />
      </DataTable.Cell>
      <DataTable.Cell onPress={goToDraft}>
        <Tooltip
          content={
            draft.data?.lastUpdateTime
              ? `Last update: ${formattedDateLong(
                  new Date(draft.data.lastUpdateTime),
                )}`
              : ''
          }
        >
          <SizableText size="$1">
            {formattedDate(new Date(draft.data?.lastUpdateTime))}
          </SizableText>
        </Tooltip>
      </DataTable.Cell>
      <DataTable.Cell onPress={goToDraft}>
        <SizableText>Authors...</SizableText>
      </DataTable.Cell>
    </DataTable.Row>
  )
}

// TODO: update types
function DirectoryItem({
  item,
}: {
  item: HMDocument & {id: UnpackedHypermediaId; hasDraft: boolean}
}) {
  const navigate = useNavigate('push')

  function goToDocument() {
    navigate({key: 'document', id: item.id})
  }
  return (
    <DataTable.Row>
      <DataTable.Cell onPress={goToDocument}>
        <XStack gap="$2" f={1}>
          <Thumbnail size={20} id={item.id} metadata={item.metadata} />
          <SizableText
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            overflow="hidden"
          >
            {item.metadata.name}
          </SizableText>
          {item.hasDraft ? (
            <Button
              size="$1"
              theme="yellow"
              flexShrink={0}
              flexGrow={0}
              onPress={(e: MouseEvent) => {
                e.stopPropagation()
                navigate({key: 'draft', id: item.id})
              }}
            >
              Resume Editing
            </Button>
          ) : null}
        </XStack>
      </DataTable.Cell>
      <DataTable.Cell noPadding onPress={goToDocument}>
        <PathButton path={item.path} onCopy={() => {}} />
      </DataTable.Cell>
      <DataTable.Cell onPress={goToDocument}>
        <Tooltip content={`Last update: ${formattedDateLong(item.updateTime)}`}>
          <SizableText size="$1">{formattedDate(item.updateTime)}</SizableText>
        </Tooltip>
      </DataTable.Cell>
      <DataTable.Cell onPress={goToDocument}>
        <SizableText>Authors...</SizableText>
      </DataTable.Cell>
    </DataTable.Row>
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
      ai="center"
      gap="$2"
      f={1}
      onPress={(e: MouseEvent) => {
        e.stopPropagation()
        onCopy()
      }}
    >
      <SizableText
        color="$blue10"
        size="$2"
        fontWeight="500"
        $group-pathitem-hover={{
          color: '$blue11',
        }}
        textOverflow="ellipsis"
        whiteSpace="nowrap"
        overflow="hidden"
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
          color: '$blue11',
        }}
      />
    </XStack>
  )
}
