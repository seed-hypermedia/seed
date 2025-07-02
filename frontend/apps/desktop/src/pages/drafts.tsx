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
import {useEntities} from '@shm/shared/models/entity'
import {Container, PanelContainer} from '@shm/ui/container'
import {SizableText} from '@shm/ui/text'
import {useMemo} from 'react'
import {GestureResponderEvent} from 'react-native'
import {Button} from 'tamagui'

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
          allLocationParents.add(hmId('d', uid, {path}).id)
        })
      }
    })
    return allLocationParents
  }, [drafts.data])
  const entities = useEntities(
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
          const id = hmId('d', uid, {path})
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
        <Container justifyContent="center" centered gap="$2">
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
      group="item"
      borderWidth={0}
      hoverStyle={{
        bg: '$color5',
      }}
      bg="$backgroundStrong"
      // elevation="$1"
      paddingHorizontal="$3"
      paddingVertical="$2"
      onPress={() => {
        navigate({key: 'draft', id: item.id, accessory: {key: 'options'}})
      }}
      h="auto"
      ai="center"
    >
      <div className="flex flex-1 items-center gap-4">
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex overflow-hidden">
            {breadcrumbs.map((breadcrumb, idx) => (
              <>
                <Button
                  color="$color9"
                  fontWeight="400"
                  size="$1"
                  textProps={{
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    hoverStyle: {
                      color: '$color11',
                    },
                  }}
                  margin={0}
                  marginRight="$1"
                  paddingHorizontal={0}
                  hoverStyle={{
                    bg: '$colorTransparent',
                  }}
                  borderWidth={0}
                  bg="$colorTransparent"
                  onPress={(e: GestureResponderEvent) => {
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
                  <SizableText size="xs" color="muted" className="mr-1">
                    /
                  </SizableText>
                )}
              </>
            ))}
          </div>
          <SizableText
            size="lg"
            weight="bold"
            className="flex-1 truncate overflow-hidden text-left whitespace-nowrap"
          >
            {getMetadataName(metadata)}
          </SizableText>
        </div>
        {/* <LibraryEntryAuthors
            item={item}
            accountsMetadata={accountsMetadata}
          /> */}
        <SizableText
          size="xs"
          color="muted"
          className="flex-shrink-0 flex-grow-0"
        >
          {formattedDateMedium(new Date(item.lastUpdateTime))}
        </SizableText>
      </div>
    </Button>
  )
}
