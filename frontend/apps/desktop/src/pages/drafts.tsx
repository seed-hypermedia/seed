import {useDeleteDraftDialog} from '@/components/delete-draft-dialog'
import {MainWrapper} from '@/components/main-wrapper'
import {useDraftList} from '@/models/documents'
import {useNavigationDispatch} from '@/utils/navigation'
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
import {Trash} from 'lucide-react'
import React, {useMemo} from 'react'

export default function DraftsPage() {
  const drafts = useDraftList()
  const allLocationParents = useMemo(() => {
    const allLocationParents = new Set<string>()
    drafts.data?.forEach((draft) => {
      // @ts-expect-error
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
      // @ts-expect-error
      const contextId = item.editId || item.locationId
      if (contextId) {
        const uid = contextId.uid
        const parentPaths = getParentPaths(contextId.path)
        // @ts-expect-error
        breadcrumbs =
          // @ts-expect-error
          contextId === item.editId
            ? parentPaths.slice(0, -1)
            : parentPaths.map((path) => {
                const id = hmId(uid, {path})
                return {
                  id,
                  metadata:
                    entities.find((e) => {
                      return e.data?.id.id === id.id
                      // @ts-expect-error
                    })?.data?.document?.metadata ?? null,
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
  const deleteDialog = useDeleteDraftDialog()
  const dispatch = useNavigationDispatch()
  const metadata = item?.metadata

  return (
    <div
      className="group hover:bg-muted h-auto w-full cursor-pointer rounded px-4 py-2"
      onClick={() => {
        navigate({key: 'draft', id: item.id, accessory: {key: 'options'}})
      }}
    >
      <div className="flex w-full items-center justify-between gap-4 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <div className="flex items-center gap-1 overflow-hidden">
            {breadcrumbs.map((breadcrumb, idx) => (
              <React.Fragment key={breadcrumb.id?.uid || idx}>
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
              </React.Fragment>
            ))}
          </div>

          <SizableText
            weight="bold"
            className="block w-full truncate overflow-hidden text-left whitespace-nowrap"
          >
            {getMetadataName(metadata)}
          </SizableText>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <SizableText size="xs" color="muted">
            {formattedDateMedium(new Date(item.lastUpdateTime))}
          </SizableText>

          <Button
            variant="destructive"
            className="hover:bg-destructive/75 dark:hover:bg-destructive/75 cursor-pointer opacity-0 group-hover:opacity-100"
            size="icon"
            onClick={(e) => {
              e.stopPropagation()
              deleteDialog.open({
                draftId: item.id,
                // TODO: add toast?
                onSuccess: () => {},
              })
            }}
          >
            <Trash className="size-3" />
          </Button>
        </div>
      </div>

      <div onClick={(e) => e.stopPropagation()}>{deleteDialog.content}</div>
    </div>
  )
}
