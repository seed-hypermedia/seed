import {useDraft} from '@/models/accounts'
import {useDraftList, useListDirectory} from '@/models/documents'
import {useSubscribedEntity} from '@/models/entities'
import {useNavigate} from '@/utils/useNavigate'
import {getMetadataName} from '@shm/shared/content'
import {
  hmId,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared/utils/entity-id-url'
import {HMIcon, SizableText, SmallListItem} from '@shm/ui'
import {useMemo} from 'react'

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
