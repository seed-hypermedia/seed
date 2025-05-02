import {
  getMetadataName,
  HMDocument,
  HMEntityContent,
  HMMetadata,
  HMQueryResult,
  hostnameStripProtocol,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {ButtonText} from '@tamagui/button'
import {XStack, YStack} from '@tamagui/stacks'
import {SizableText} from '@tamagui/text'
import React, {useMemo, useState} from 'react'
import {Button} from './button'
import {DraftBadge} from './draft-badge'
import {Close, Menu, X} from './icons'
import {
  DocNavigationDocument,
  DocumentOutline,
  DocumentSmallListItem,
  getSiteNavDirectory,
} from './navigation'
import {HeaderSearch, MobileSearch} from './search'
import {SiteLogo} from './site-logo'
import {useIsDark} from './use-is-dark'

export function SiteHeader({
  originHomeId,
  docId,
  afterLinksContent,
  items,
  isCenterLayout = false,
  children,
  document,
  supportDocuments,
  onBlockFocus,
  onShowMobileMenu,
  supportQueries,
  origin,
  onScroll,
}: {
  originHomeId: UnpackedHypermediaId | null
  docId: UnpackedHypermediaId | null
  afterLinksContent?: React.ReactNode
  items?: DocNavigationDocument[]
  isCenterLayout?: boolean
  children?: React.ReactNode
  document?: HMDocument
  supportDocuments?: HMEntityContent[]
  onBlockFocus?: (blockId: string) => void
  onShowMobileMenu?: (isOpen: boolean) => void
  supportQueries?: HMQueryResult[]
  origin?: string
  onScroll?: () => void
}) {
  const isDark = useIsDark()
  const [isMobileMenuOpen, _setIsMobileMenuOpen] = useState(false)
  function setIsMobileMenuOpen(isOpen: boolean) {
    _setIsMobileMenuOpen(isOpen)
    onShowMobileMenu?.(isOpen)
  }
  const homeDoc = !docId?.path?.length
    ? {document, id: docId}
    : supportDocuments?.find(
        (doc) => doc.id.uid === docId?.uid && !doc.id.path?.length,
      )
  const headerSearch = (
    <>
      <Button
        $gtSm={{display: 'none'}}
        icon={<Menu size={20} />}
        chromeless
        size="$2"
        onPress={() => {
          setIsMobileMenuOpen(true)
        }}
      />
      {originHomeId ? (
        <XStack display="none" $gtSm={{display: 'flex'}}>
          <HeaderSearch originHomeId={originHomeId} />
        </XStack>
      ) : null}
    </>
  )
  const isHomeDoc = !docId?.path?.length
  if (!homeDoc) return null
  const headerHomeId = homeDoc.id
  if (!headerHomeId) return null
  const mainHeader = (
    <YStack
      position="relative"
      overflowX="hidden"
      $gtSm={{overflowX: 'inherit'}}
      h="100%"
      minHeight="calc(100vh - 78px)"
      onScroll={onScroll}
    >
      <YStack
        borderBottomWidth={1}
        borderColor="$borderColor"
        zIndex="$zIndex.8"
        // @ts-ignore
        position="sticky"
        top={0}
        right={0}
        left={0}
        backgroundColor={isDark ? '$background' : '$backgroundStrong'}
        // this data attribute is used by the hypermedia highlight component
        data-docid={headerHomeId.id}
      >
        <XStack // Rendered as YStack when isCenterLayout
          paddingVertical="$2"
          ai="center"
          paddingHorizontal="$4"
          minHeight={56}
          gap="$2"
          flexDirection={isCenterLayout ? 'column' : 'row'}
        >
          <XStack
            ai="center"
            jc={isCenterLayout ? 'center' : 'flex-start'}
            alignSelf="stretch"
            flexShrink={0}
          >
            <XStack f={1} jc="center">
              <SiteLogo
                id={headerHomeId}
                metadata={homeDoc.document?.metadata}
              />
            </XStack>
            {isCenterLayout ? headerSearch : null}
          </XStack>
          <XStack
            flex={1}
            // @ts-ignore
            overflowX="auto"
            overflowY="hidden"
            maxWidth="100%"
          >
            <XStack minWidth="100%" jc="flex-end">
              {items?.length || afterLinksContent ? (
                <XStack
                  ai="center"
                  gap="$5"
                  minWidth="fit-content"
                  padding="$2"
                  jc="center"
                  display="none"
                  flexShrink={0}
                  $gtSm={{display: 'flex'}}
                >
                  {items?.map((item) => {
                    return (
                      <HeaderLinkItem
                        id={item.id}
                        key={item.id?.id || item.draftId || '?'}
                        metadata={item.metadata}
                        draftId={item.draftId}
                        isPublished={item.isPublished}
                        active={
                          !!docId?.path &&
                          !!item.id?.path &&
                          item.id.path?.[0] === docId.path[0]
                        }
                      />
                    )
                  })}
                  {afterLinksContent}
                </XStack>
              ) : null}
            </XStack>
          </XStack>

          {isCenterLayout ? null : headerSearch}
        </XStack>
      </YStack>
      {children}
      <MobileMenu
        open={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        renderContent={() => (
          <YStack>
            <MobileSearch originHomeId={originHomeId} />

            {isHomeDoc ? null : ( // if we are on the home page, we will see the home directory below the outline
              <YStack gap="$2.5" marginTop="$2.5" marginBottom="$4">
                {items?.map((item) => (
                  <DocumentSmallListItem
                    key={item.id.id}
                    id={item.id}
                    metadata={item.metadata}
                    isDraft={item.isDraft}
                    isPublished={item.isPublished}
                  />
                ))}
              </YStack>
            )}

            {docId && document && !isHomeDoc && (
              <DocumentOutline
                onActivateBlock={(blockId) => {
                  setIsMobileMenuOpen(false)
                  onBlockFocus?.(blockId)
                }}
                document={document}
                id={docId}
                // onCloseNav={() => {}}
                supportDocuments={supportDocuments}
                activeBlockId={docId.blockRef}
              />
            )}
            {docId && <NavItems id={docId} supportQueries={supportQueries} />}
          </YStack>
        )}
      />
    </YStack>
  )
  return (
    <>
      {/* TODO: Eric change this to true when we are */}
      <GotoLatestBanner isLatest={true} />
      {docId && origin && originHomeId && originHomeId.uid !== docId.uid ? (
        <YStack padding="$2" alignItems="center" backgroundColor="$brand5">
          <SizableText color="white" size="$3">
            Hosted on{' '}
            <ButtonText color="white" tag="a" href="/">
              {hostnameStripProtocol(origin)}
            </ButtonText>{' '}
            via the{' '}
            <ButtonText
              color="white"
              tag="a"
              target="_blank"
              href="https://hyper.media"
            >
              Hypermedia Protocol
            </ButtonText>
            .
          </SizableText>
        </YStack>
      ) : null}
      {mainHeader}
    </>
  )
}

function NavItems({
  id,
  supportQueries,
}: {
  id: UnpackedHypermediaId
  supportQueries?: HMQueryResult[]
}) {
  const directoryItems = getSiteNavDirectory({
    id,
    supportQueries,
    // todo: pass drafts
  })
  return (
    <YStack gap="$2.5">
      {directoryItems
        ? directoryItems.map((doc) => (
            <DocumentSmallListItem
              key={id.path?.join('/') || id.id}
              metadata={doc.metadata}
              id={doc.id}
              indented={0}
              draftId={doc.draftId}
              isPublished={doc.isPublished}
            />
          ))
        : null}
    </YStack>
  )
}

export function SmallSiteHeader({
  originHomeMetadata,
  originHomeId,
  siteHost,
}: {
  originHomeMetadata: HMMetadata
  originHomeId: UnpackedHypermediaId
  siteHost: string
}) {
  return (
    <YStack
      backgroundColor="$backgroundStrong"
      // this data attribute is used by the hypermedia highlight component
      data-docid={originHomeId.id}
      ai="center"
      width="100vw"
    >
      <XStack maxWidth={600} width="100%">
        <XStack paddingHorizontal="$4" paddingVertical="$2">
          <SiteLogo id={originHomeId} metadata={originHomeMetadata} />
        </XStack>
      </XStack>
    </YStack>
  )
}

function HeaderLinkItem({
  id,
  metadata,
  active,
  draftId,
  isPublished,
}: {
  id?: UnpackedHypermediaId
  draftId?: string | null
  metadata: HMMetadata
  active: boolean
  isPublished?: boolean
}) {
  // TODO: change this to use the draft id
  const linkProps = useRouteLink(
    draftId
      ? {
          key: 'draft',
          id: draftId,
        }
      : id
      ? {
          key: 'document',
          id,
        }
      : null,
  )
  const baseColor = isPublished === false ? '$color9' : '$color10'
  return (
    <XStack
      ai="center"
      gap="$1"
      hoverStyle={draftId ? {bg: '$backgroundHover'} : undefined}
      paddingHorizontal="$1"
      // this data attribute is used by the hypermedia highlight component
      data-docid={id?.id}
    >
      <SizableText
        numberOfLines={1}
        userSelect="none"
        fontWeight="bold"
        color={active ? '$color' : baseColor}
        paddingHorizontal="$1"
        hoverStyle={{cursor: 'pointer', color: active ? '$color' : '$color11'}}
        {...linkProps}
      >
        {getMetadataName(metadata)}
      </SizableText>
      {draftId ? <DraftBadge /> : null}
    </XStack>
  )
}

export function MobileMenu({
  renderContent,
  open,
  onClose,
}: {
  renderContent: () => React.JSX.Element
  open: boolean
  onClose: () => void
}) {
  return (
    <YStack
      $gtSm={{
        display: 'none',
      }}
      backgroundColor="$background"
      fullscreen
      // @ts-ignore
      position="absolute"
      top={0}
      right={0}
      bottom={0}
      zIndex="var(--z-index-9, 800)"
      x={open ? 0 : '100%'}
      animation="fast"
    >
      <YStack height="calc(100vh - 64px)" position="sticky" top={0}>
        <XStack p="$4" alignItems="center">
          <Button
            icon={<Close size={24} />}
            chromeless
            size="$2"
            onPress={onClose}
          />
        </XStack>
        <YStack
          p="$4"
          paddingBottom={50}
          flex={1}
          overflow="scroll"
          className="mobile-menu"
        >
          {open ? renderContent() : null}
        </YStack>
      </YStack>
    </YStack>
  )
}

function GotoLatestBanner({isLatest = true}: {isLatest: boolean}) {
  // TODO: Eric change this to true when we are
  const [showVersionBanner, setShowVersionBanner] = useState(false)

  const show = useMemo(() => {
    if (!isLatest) return true
    return showVersionBanner
  }, [isLatest, showVersionBanner])

  return show ? (
    <XStack
      borderColor="black"
      position="absolute"
      top={70}
      left={0}
      right={0}
      zIndex="$zIndex.8"
      h={0}
      jc="center"
    >
      <XStack
        minHeight={60}
        bg="$background"
        elevation="$4"
        overflow="hidden"
        borderRadius="$4"
        maxWidth={600}
        alignItems="center"
        width="100%"
        p="$4"
        paddingRight="$2"
        gap="$2"
      >
        <SizableText flex={1}>This is not the latest version</SizableText>
        <Button
          bg="$brand10"
          hoverStyle={{bg: '$brand11'}}
          focusStyle={{bg: '$brand11'}}
          size="$2"
        >
          Go to latest
        </Button>
        <Button
          size="$2"
          onPress={() => setShowVersionBanner(false)}
          icon={X}
        />
      </XStack>
    </XStack>
  ) : null
}
