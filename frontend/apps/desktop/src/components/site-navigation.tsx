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
import {ReactNode, useLayoutEffect} from 'react'
import {Button, YStack} from 'tamagui'
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
  const popoverState = usePopoverState()
  const route = useNavRoute()
  const media = useMedia()
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

  useLayoutEffect(() => {
    if (media.gtSm && popoverState.open) {
      popoverState.onOpenChange(false)
    }
  }, [media.gtSm])

  if (!document || !siteListQuery || !metadata) return null

  let content = (
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
              popoverState.onOpenChange(false)
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

  return (
    <>
      <YStack $gtSm={{display: 'none'}}>
        <Popover placement="right" {...popoverState}>
          <Popover.Trigger
            opacity={popoverState.open ? 0 : 1}
            bg="$color6"
            x={-18}
            paddingVertical="$3"
            paddingHorizontal={3}
            borderRadius={100}
            gap="$3"
            jc="space-between"
            w="100%"
            enterStyle={{opacity: 0}}
            exitStyle={{opacity: 0}}
            animation="fast"
          >
            <XStack bg="$color8" h={2} w="90%" borderRadius="$8" />
            <XStack bg="$color8" h={2} w="90%" borderRadius="$8" />
            <XStack bg="$color8" h={2} w="90%" borderRadius="$8" />
            <XStack bg="$color8" h={2} w="90%" borderRadius="$8" />
            <XStack bg="$color8" h={2} w="90%" borderRadius="$8" />
          </Popover.Trigger>
          <Popover.Content
            enterStyle={{x: -10, opacity: 0}}
            exitStyle={{x: -10, opacity: 0}}
            animation="fast"
            elevation="$4"
          >
            {content}
          </Popover.Content>
        </Popover>
      </YStack>
      <YStack display="none" $gtSm={{display: 'flex'}}>
        {content}
      </YStack>
    </>
  )
}
