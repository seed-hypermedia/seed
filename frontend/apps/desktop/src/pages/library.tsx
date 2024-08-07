import {MainWrapperNoScroll} from '@/components/main-wrapper'
import {useDeleteDraft, useDraftList} from '@/models/documents'
import {useOpenDraft} from '@/utils/open-draft'
import {HMDocument, UnpackedHypermediaId, unpackHmId} from '@shm/shared'
import {
  Button,
  Container,
  Footer,
  Search,
  toast,
  Tooltip,
  XStack,
  YStack,
} from '@shm/ui'
import {ArrowDownUp, LayoutGrid, List, Settings2} from '@tamagui/lucide-icons'
import {useMemo, useState} from 'react'

export default function ContentPage() {
  const [listType, setListType] = useState<'list' | 'cards'>('cards')
  const backendDrafts = useDraftList()

  const draftList = useMemo<Array<UnpackedHypermediaId>>(() => {
    return (
      backendDrafts.data
        ?.map((draftId) => {
          const id = unpackHmId(draftId)
          if (!id) return null
          return id
        })
        .filter((id) => {
          if (!id) return false
          return true
        }) || []
    )
  }, [backendDrafts.data])

  const openDraft = useOpenDraft('push')
  const deleteDraft = useDeleteDraft()
  function handleDelete(id: string) {
    deleteDraft.mutateAsync(id).then(() => {
      toast.success('Draft Deleted Successfully')
    })
  }

  return (
    <>
      <MainWrapperNoScroll>
        <Container>
          <XStack f={1} flexGrow={0}>
            <XStack gap="$2" w="100%">
              <XStack f={1} />
              <LibrarySearch />
              <Button size="$2" icon={Settings2} />
              <Button size="$2" icon={ArrowDownUp} />
              <Tooltip
                content={`Show items as ${
                  listType == 'cards' ? 'lists' : 'cards'
                }`}
              >
                <Button
                  onPress={() => {
                    setListType((v) => (v == 'cards' ? 'list' : 'cards'))
                  }}
                  size="$2"
                  icon={listType == 'cards' ? List : LayoutGrid}
                />
              </Tooltip>
            </XStack>
          </XStack>
          <YStack>
            {listType == 'list' ? (
              <EntityList drafts={draftList} documents={[]} />
            ) : listType == 'cards' ? (
              <EntityCards drafts={draftList} documents={[]} />
            ) : null}
          </YStack>
        </Container>
      </MainWrapperNoScroll>
      <Footer></Footer>
    </>
  )
}

function LibrarySearch() {
  return <Button size="$2" icon={Search} />
}

function EntityCards({
  drafts,
  documents,
}: {
  documents: Array<{
    document?: HMDocument
    id: UnpackedHypermediaId
    hasDraft: boolean
  }>
  drafts?: Array<UnpackedHypermediaId>
}) {
  return null
}

function EntityList({
  drafts,
  documents,
}: {
  documents: Array<{
    document?: HMDocument
    id: UnpackedHypermediaId
    hasDraft: boolean
  }>
  drafts?: Array<UnpackedHypermediaId>
}) {
  return null
}
