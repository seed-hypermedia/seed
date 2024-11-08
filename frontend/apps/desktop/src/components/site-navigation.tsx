import {focusDraftBlock} from '@/draft-focusing'
import {roleCanWrite, useMyCapability} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {
  useCreateDraft,
  useDocumentEmbeds,
  useListSite,
} from '@/models/documents'
import {useEntity} from '@/models/entities'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {hmId} from '@shm/shared'
import {SiteNavigationPlaceholder} from '@shm/shared/src/site-navigation'
import {
  DocumentOutline,
  DraftOutline,
  Popover,
  SiteNavigationContent,
  SmallListItem,
  useMedia,
  usePopoverState,
  XStack,
} from '@shm/ui'
import {MoreHorizontal, Plus} from '@tamagui/lucide-icons'
import {ReactNode} from 'react'
import {Button} from 'tamagui'
import {ImportDropdownButton} from './import-doc-button'

export function SiteNavigation() {
  const popoverProps = usePopoverState()

  const media = useMedia()
  return media.gtSm ? (
    <SiteNavigationLoader />
  ) : (
    <Popover {...popoverProps} placement="right-end">
      <Popover.Trigger asChild>
        <SiteNavigationPlaceholder />
      </Popover.Trigger>
      <Popover.Content
        enterStyle={{y: -10, opacity: 0}}
        exitStyle={{y: -10, opacity: 0}}
        animation="fast"
        elevation="$4"
      >
        <SiteNavigationLoader />
      </Popover.Content>
    </Popover>
  )
}

export function SiteNavigationLoader({onPress}: {onPress?: () => void}) {
  const route = useNavRoute()
  if (route.key !== 'document')
    throw new Error('SiteNavigation only supports document route')
  const {id} = route
  const entity = useEntity(id)
  const navigate = useNavigate()
  const document = entity.data?.document
  const createDraft = useCreateDraft(id)
  const capability = useMyCapability(id)
  const siteList = useListSite(id)
  const siteListQuery = siteList?.data
    ? {in: hmId('d', id.uid), results: siteList.data}
    : null
  const embeds = useDocumentEmbeds(document)

  let createDirItem: null | ((opts: {indented: number}) => ReactNode) = null
  if (roleCanWrite(capability?.role)) {
    createDirItem = ({indented}) => (
      <XStack>
        <SmallListItem
          icon={Plus}
          title="Create Document"
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
  if (!document || !siteListQuery) return null

  return (
    <SiteNavigationContent
      documentMetadata={document.metadata}
      id={id}
      supportDocuments={embeds}
      supportQueries={[siteListQuery]}
      createDirItem={createDirItem}
      onPress={onPress}
      outline={({indented}) => (
        <DocumentOutline
          onActivateBlock={(blockId) => {
            onPress?.()
            navigate({
              key: 'document',
              id: hmId(id.type, id.uid, {blockRef: blockId, path: id.path}),
            })
          }}
          document={document}
          id={id}
          supportDocuments={embeds}
          activeBlockId={id.blockRef}
          indented={indented}
        />
      )}
    />
  )
}

export function SiteNavigationDraftLoader() {
  const route = useNavRoute()
  if (route.key !== 'draft')
    throw new Error('SiteNavigationDraftLoader only supports draft route')
  const {id} = route
  const entity = useEntity(id)
  const draftQuery = useDraft(id)
  const metadata = draftQuery?.data?.metadata || entity.data?.document?.metadata

  const document = entity.data?.document

  const siteList = useListSite(id)
  const siteListQuery = siteList?.data
    ? {in: hmId('d', id.uid), results: siteList.data}
    : null
  const embeds = useDocumentEmbeds(document)

  if (!document || !siteListQuery || !metadata) return null

  return (
    <SiteNavigationContent
      documentMetadata={metadata}
      id={id}
      supportDocuments={embeds}
      supportQueries={[siteListQuery]}
      outline={({indented}) =>
        draftQuery.data ? (
          <DraftOutline
            indented={indented}
            onActivateBlock={(blockId: string) => {
              focusDraftBlock(id.id, blockId)
            }}
            draft={draftQuery.data}
            id={id}
            supportDocuments={embeds}
            onPress={() => {}}
          />
        ) : null
      }
    />
  )
}
