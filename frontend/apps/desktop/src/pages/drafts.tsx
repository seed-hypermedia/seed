import {MainWrapper} from '@/components/main-wrapper'
import {useDraftList} from '@/models/documents'
import {useNavigate} from '@/utils/useNavigate'
import {
  formattedDateMedium,
  getMetadataName,
  getParentPaths,
  hmId,
  HMListedDraft,
  HMMetadataPayload,
  unpackHmId,
} from '@shm/shared'
import {useResources} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {Container, PanelContainer} from '@shm/ui/container'
import {SizableText} from '@shm/ui/text'
import {useMemo} from 'react'

export default function DraftsPage() {
  const drafts = useDraftList()
  const allLocationParents = useMemo(() => {
    const allLocationParents = new Set<string>()
    drafts.data?.forEach((draft) => {
      const contextId = draft.editId || draft.locationId
      if (contextId) {
        const uid = contextId.uid
        const parentPaths = getParentPaths(contextId.path)
        parentPaths.forEach((path) => {
          allLocationParents.add(hmId(uid, {path}).id)
        })
      }
    })
    return allLocationParents
  }, [drafts.data])
  const entities = useResources(
    Array.from(allLocationParents)
      .map((id) => unpackHmId(id))
      .filter((id) => !!id),
  )
  const draftItems = useMemo(() => {
    return drafts.data?.map((item) => {
      let breadcrumbs: HMMetadataPayload[] = []
      const contextId = item.editId || item.locationId
      if (contextId) {
        const uid = contextId.uid
        const parentPaths = getParentPaths(contextId.path)
        breadcrumbs = (
          contextId === item.editId ? parentPaths.slice(0, -1) : parentPaths
        ).map((path) => {
          const id = hmId(uid, {path})
          return {
            id,
            metadata:
              entities.find((e) => e.data?.id.id === id.id)?.data?.document
                ?.metadata ?? null,
          }
        })
      }
      return {
        ...item,
        breadcrumbs,
      }
    })
  }, [drafts.data, entities])
  return (
    <PanelContainer>
      <MainWrapper scrollable>
        <Container centered className="gap-2">
          {draftItems?.map((item) => {
            return (
              <DraftItem
                item={item}
                key={item.id}
                breadcrumbs={item.breadcrumbs}
              />
            )
          })}
        </Container>
      </MainWrapper>
    </PanelContainer>
  )
}

export function DraftItem({
  item,
  breadcrumbs,
}: {
  item: HMListedDraft
  breadcrumbs: HMMetadataPayload[]
}) {
  const navigate = useNavigate()
  const metadata = item?.metadata
  return (
    <Button
      className="h-auto"
      onClick={() => {
        navigate({key: 'draft', id: item.id, accessory: {key: 'options'}})
      }}
    >
      <div className="flex-1 items-center gap-4 overflow-hidden">
        <div className="flex items-center gap-1 overflow-hidden">
          {breadcrumbs.map((breadcrumb, idx) => (
            <>
              <Button
                variant="link"
                size="xs"
                className="p-0"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  navigate({
                    key: 'document',
                    id: breadcrumb.id,
                  })
                }}
              >
                {breadcrumb.metadata?.name ??
                  breadcrumb.id?.path?.at(-1) ??
                  '?'}
              </Button>
              {idx === breadcrumbs.length - 1 ? null : (
                <SizableText size="xs" color="muted">
                  /
                </SizableText>
              )}
            </>
          ))}
        </div>
        <SizableText
          weight="bold"
          className="block w-full flex-1 truncate overflow-hidden text-left whitespace-nowrap"
        >
          {getMetadataName(metadata)}
        </SizableText>
      </div>
      <SizableText
        size="xs"
        color="muted"
        className="flex-shrink-0 flex-grow-0"
      >
        {formattedDateMedium(new Date(item.lastUpdateTime))}
      </SizableText>
    </Button>
  )
}
