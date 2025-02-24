import {focusDraftBlock} from '@/draft-focusing'
import {roleCanWrite, useMyCapability} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {
  useAccountDraftList,
  useCreateDraft,
  useDocumentEmbeds,
  useListSite,
} from '@/models/documents'
import {useEntity, useSubscribedEntity} from '@/models/entities'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {SmallListItem} from '@shm/ui/list-item'
import {
  DocDirectory,
  DocumentOutline,
  DraftOutline,
  SiteNavigationWrapper,
} from '@shm/ui/navigation'
import {Plus as Add, MoreHorizontal} from '@tamagui/lucide-icons'
import {ReactNode} from 'react'
import {XStack} from 'tamagui'
import {ImportDropdownButton} from './import-doc-button'

export function SiteNavigation() {
  return (
    <SiteNavigationWrapper>
      <SiteNavigationLoader />
    </SiteNavigationWrapper>
  )
}

export function SiteNavigationLoader({onPress}: {onPress?: () => void}) {
  const route = useNavRoute()
  if (route.key !== 'document')
    throw new Error('SiteNavigation only supports document route')
  const {id} = route
  const entity = useSubscribedEntity(id, true) // recursive subscriptions to make sure children get loaded
  const navigate = useNavigate('replace')
  const document = entity.data?.document
  const createDraft = useCreateDraft(id)
  const capability = useMyCapability(id)
  const siteList = useListSite(id)
  const isHome = !id.path?.length
  const siteListQuery = siteList?.data ? {in: id, results: siteList.data} : null

  const embeds = useDocumentEmbeds(document)

  let createDirItem: null | ((opts: {indented: number}) => ReactNode) = null
  if (roleCanWrite(capability?.role)) {
    createDirItem = ({indented}) => (
      <XStack>
        <SmallListItem
          icon={Add}
          title="Create"
          onPress={createDraft}
          color="$green10"
          indented={indented}
        />
        <ImportDropdownButton
          id={id}
          button={
            <Button
              position="absolute"
              top={6}
              right={20}
              size="$1"
              circular
              icon={MoreHorizontal}
            />
          }
        />
      </XStack>
    )
  }
  const drafts = useAccountDraftList(id.uid)

  if (!document || !siteListQuery) return null

  return (
    <>
      <DocumentOutline
        onActivateBlock={(blockId) => {
          onPress?.()
          navigate({
            key: 'document',
            id: hmId(id.type, id.uid, {blockRef: blockId, path: id.path}),
          })
          const targetElement = window.document.getElementById(blockId)
          if (targetElement) {
            targetElement.scrollIntoView({behavior: 'smooth', block: 'start'})
          } else {
            console.error('Element not found:', blockId)
          }
        }}
        document={document}
        id={id}
        supportDocuments={embeds}
        activeBlockId={id.blockRef}
      />
      {!isHome && (
        <DocDirectory
          id={id}
          drafts={drafts.data}
          supportQueries={[siteListQuery]}
          createDirItem={createDirItem}
          onPress={onPress}
        />
      )}
    </>
  )
}

export function SiteNavigationDraftLoader() {
  const route = useNavRoute()
  if (route.key !== 'draft')
    throw new Error('SiteNavigationDraftLoader only supports draft route')
  const {id} = route
  const entity = useEntity(id)
  const draftQuery = useDraft(id)
  const draft = draftQuery?.data
  const metadata = draftQuery?.data?.metadata || entity.data?.document?.metadata

  const document = entity.data?.document

  const siteList = useListSite(id)
  const siteListQuery = siteList?.data
    ? {in: hmId('d', id.uid), results: siteList.data}
    : null
  const embeds = useDocumentEmbeds(document)

  const drafts = useAccountDraftList(id.uid)

  if (!siteListQuery || !metadata) return null

  return (
    <SiteNavigationWrapper>
      {draft ? (
        <DraftOutline
          onActivateBlock={(blockId: string) => {
            focusDraftBlock(id.id, blockId)
          }}
          draft={draft}
          id={id}
          supportDocuments={embeds}
          onPress={() => {}}
        />
      ) : null}
      <DocDirectory
        id={id}
        drafts={drafts.data}
        supportQueries={[siteListQuery]}
      />
    </SiteNavigationWrapper>
  )
}
