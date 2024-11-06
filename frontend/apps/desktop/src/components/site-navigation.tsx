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
import {hmId, NodesOutline} from '@shm/shared'
import {SiteNavigationPlaceholder} from '@shm/shared/src/site-navigation'
import {
  FocusButton,
  Popover,
  SiteNavigationContent,
  SiteNavigationOutline,
  SmallListGroupItem,
  SmallListItem,
  useMedia,
  usePopoverState,
  View,
  XStack,
} from '@shm/ui'
import {Hash, MoreHorizontal, Plus} from '@tamagui/lucide-icons'
import {memo, ReactNode} from 'react'
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
  const isTopLevel = !id.path || id.path?.length == 0

  const documentIndent = isTopLevel ? 0 : 1
  const createDraft = useCreateDraft(id)
  const capability = useMyCapability(id)
  const siteList = useListSite(id)
  const siteListQuery = siteList?.data
    ? {in: hmId('d', id.uid), results: siteList.data}
    : null
  const embeds = useDocumentEmbeds(document)
  let createDirItem: null | ReactNode = null

  if (roleCanWrite(capability?.role)) {
    createDirItem = (
      <XStack>
        <SmallListItem
          icon={Plus}
          title="Create Document"
          onPress={createDraft}
          color="$green10"
          indented={documentIndent + 1}
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
      outline={
        <SiteNavigationOutline
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
          indented={1}
        />
      }
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

  if (!document || !siteListQuery) return null

  return (
    <SiteNavigationContent
      // document={document}
      documentMetadata={metadata}
      id={id}
      supportDocuments={embeds}
      supportQueries={[siteListQuery]}
      outline={null}
      // onActivateBlock={(blockId) => {
      //   // todo!
      // }}
    />
  )
}

function _DraftOutline({
  activeBlock,
  onActivateBlock,
  onFocusBlock,
  indented = 0,
  outline,
}: {
  activeBlock?: string
  onActivateBlock: (blockId: string) => void
  onFocusBlock: ((blockId: string) => void) | null
  indented?: number
  outline: NodesOutline
}) {
  function getOutline(outlineNodes: NodesOutline, level = 0): ReactNode[] {
    const outlineContent = outlineNodes.map((item) => {
      const childrenOutline = item.children
        ? getOutline(item.children, level + 1)
        : null
      return (
        <SmallListGroupItem
          key={item.id}
          onPress={() => {
            onActivateBlock(item.id)
          }}
          active={item.id === activeBlock}
          activeBgColor={item.id === activeBlock ? '$brand12' : undefined}
          icon={
            <View width={16}>
              {item.icon ? (
                <item.icon color="$color9" size={16} />
              ) : (
                <Hash color="$color9" size={16} />
              )}
            </View>
          }
          title={item.title || 'Untitled Heading'}
          indented={1 + level}
          items={childrenOutline || []}
          rightHover={[
            onFocusBlock ? (
              <FocusButton
                key="focus"
                onPress={() => {
                  onFocusBlock(item.id)
                }}
              />
            ) : null,
          ]}
          defaultExpanded
        />
      )
    })
    return outlineContent
  }

  return getOutline(outline, indented)
}
const DraftOutline = memo(_DraftOutline)
