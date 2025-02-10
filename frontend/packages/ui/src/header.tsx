import {
  getMetadataName,
  HMDocument,
  HMEntityContent,
  HMMetadata,
  HMQueryResult,
  UnpackedHypermediaId,
  useRouteLink,
} from "@shm/shared";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import React, {useState} from "react";
import {Button} from "./button";
import {ContainerXL} from "./container";
import {Close, Menu} from "./icons";
import {
  DocumentOutline,
  DocumentSmallListItem,
  getSiteNavDirectory,
  SiteNavigationDocument,
} from "./navigation";
import {HeaderSearch, MobileSearch} from "./search";
import {SiteLogo} from "./site-logo";

export function SiteHeader({
  homeMetadata,
  homeId,
  docId,
  afterLinksContent,
  items,
  headItems,
  isCenterLayout = false,
  children,
  document,
  supportDocuments,
  supportQueries,
  onBlockFocus,
  onShowMobileMenu,
}: {
  homeMetadata: HMMetadata | null;
  homeId: UnpackedHypermediaId | null;
  docId: UnpackedHypermediaId | null;
  afterLinksContent?: React.ReactNode;
  items?: SiteNavigationDocument[];
  headItems?: React.ReactNode;
  isCenterLayout?: boolean;
  children?: React.ReactNode;
  document?: HMDocument;
  supportDocuments?: HMEntityContent[];
  supportQueries?: HMQueryResult[];
  onBlockFocus?: (blockId: string) => void;
  onShowMobileMenu?: (isOpen: boolean) => void;
}) {
  const [isMobileMenuOpen, _setIsMobileMenuOpen] = useState(false);
  function setIsMobileMenuOpen(isOpen: boolean) {
    _setIsMobileMenuOpen(isOpen);
    onShowMobileMenu?.(isOpen);
  }
  const headerSearch = (
    <>
      <Button
        $gtSm={{display: "none"}}
        icon={<Menu size={20} />}
        chromeless
        size="$2"
        onPress={() => {
          setIsMobileMenuOpen(true);
        }}
      />
      {homeId ? (
        <XStack display="none" $gtSm={{display: "flex"}}>
          <HeaderSearch homeId={homeId} />
        </XStack>
      ) : null}
    </>
  );
  const isHomeDoc = !docId?.path?.length;
  if (!homeId) return null;
  return (
    <YStack position="relative" overflowX="hidden">
      <YStack
        borderBottomWidth={1}
        borderColor="$borderColor"
        zIndex="$zIndex.7"
        // @ts-ignore
        position="sticky"
        top={0}
        right={0}
        left={0}
        backgroundColor="$background"
      >
        <ContainerXL>
          <XStack // Rendered as YStack when isCenterLayout
            paddingVertical="$2"
            ai="center"
            gap="$2"
            flexDirection={isCenterLayout ? "column" : "row"}
          >
            <XStack
              ai="center"
              jc={isCenterLayout ? "center" : "flex-start"}
              alignSelf="stretch"
              flexShrink={0}
            >
              <XStack f={1} jc="center">
                <SiteLogo id={homeId} metadata={homeMetadata} />
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
                    gap="$2"
                    minWidth="fit-content"
                    padding="$2"
                    jc="center"
                    display="none"
                    flexShrink={0}
                    $gtSm={{display: "flex"}}
                  >
                    {items?.map((item) => {
                      return (
                        <HeaderLinkItem
                          id={item.id}
                          key={item.id.id}
                          metadata={item.metadata}
                          isDraft={item.isDraft}
                          isPublished={item.isPublished}
                          active={
                            !!docId?.path &&
                            !!item.id.path &&
                            item.id.path?.[0] === docId.path[0]
                          }
                        />
                      );
                    })}
                    {afterLinksContent}
                  </XStack>
                ) : null}
              </XStack>
            </XStack>

            {isCenterLayout ? null : headerSearch}
            {headItems}
          </XStack>
        </ContainerXL>
      </YStack>
      {children}
      <MobileMenu
        open={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        renderContent={() => (
          <YStack>
            <MobileSearch homeId={homeId} />

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
                  setIsMobileMenuOpen(false);
                  onBlockFocus?.(blockId);
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
  );
}

function NavItems({
  id,
  supportQueries,
}: {
  id: UnpackedHypermediaId;
  supportQueries?: HMQueryResult[];
}) {
  const directoryItems = getSiteNavDirectory({
    id,
    supportQueries,
    // todo: pass drafts
  });
  return (
    <YStack gap="$2.5">
      {directoryItems
        ? directoryItems.map((doc) => (
            <DocumentSmallListItem
              key={id.path?.join("/") || id.id}
              metadata={doc.metadata}
              id={doc.id}
              indented={0}
              isDraft={doc.isDraft}
              isPublished={doc.isPublished}
            />
          ))
        : null}
    </YStack>
  );
}

function HeaderLinkItem({
  id,
  metadata,
  active,
  isDraft,
  isPublished,
}: {
  id: UnpackedHypermediaId;
  metadata: HMMetadata;
  active: boolean;
  isDraft?: boolean;
  isPublished?: boolean;
}) {
  const linkProps = useRouteLink(
    isDraft
      ? {key: "draft", id}
      : {
          key: "document",
          id,
        }
  );
  const baseColor = isPublished === false ? "$color9" : "$color10";
  return (
    <SizableText
      numberOfLines={1}
      fontWeight="bold"
      backgroundColor={isDraft ? "$yellow4" : undefined}
      color={active ? "$color" : baseColor}
      paddingHorizontal="$1"
      hoverStyle={{cursor: "pointer", color: active ? "$color" : "$color11"}}
      {...linkProps}
    >
      {getMetadataName(metadata)}
    </SizableText>
  );
}

export function MobileMenu({
  renderContent,
  open,
  onClose,
}: {
  renderContent: () => React.JSX.Element;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <YStack
      $gtSm={{
        display: "none",
      }}
      backgroundColor="$background"
      fullscreen
      // @ts-ignore
      position="absolute"
      top={0}
      right={0}
      bottom={0}
      zIndex="$zIndex.7"
      x={open ? 0 : "100%"}
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
  );
}
