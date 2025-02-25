import {
  getMetadataName,
  HMDocument,
  HMEntityContent,
  HMMetadata,
  HMQueryResult,
  hostnameStripProtocol,
  UnpackedHypermediaId,
  useRouteLink,
} from "@shm/shared";
import {ButtonText} from "@tamagui/button";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import React, {useState} from "react";
import {Button} from "./button";
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
}: {
  originHomeId: UnpackedHypermediaId | null;
  docId: UnpackedHypermediaId | null;
  afterLinksContent?: React.ReactNode;
  items?: SiteNavigationDocument[];
  isCenterLayout?: boolean;
  children?: React.ReactNode;
  document?: HMDocument;
  supportDocuments?: HMEntityContent[];
  onBlockFocus?: (blockId: string) => void;
  onShowMobileMenu?: (isOpen: boolean) => void;
  supportQueries?: HMQueryResult[];
  origin?: string;
}) {
  const [isMobileMenuOpen, _setIsMobileMenuOpen] = useState(false);
  function setIsMobileMenuOpen(isOpen: boolean) {
    _setIsMobileMenuOpen(isOpen);
    onShowMobileMenu?.(isOpen);
  }
  const homeDoc = !docId?.path?.length
    ? {document, id: docId}
    : supportDocuments?.find(
        (doc) => doc.id.uid === docId?.uid && !doc.id.path?.length
      );
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
      {originHomeId ? (
        <XStack display="none" $gtSm={{display: "flex"}}>
          <HeaderSearch originHomeId={originHomeId} />
        </XStack>
      ) : null}
    </>
  );
  const isHomeDoc = !docId?.path?.length;
  if (!homeDoc) return null;
  const headerHomeId = homeDoc.id;
  if (!headerHomeId) return null;
  const mainHeader = (
    <YStack
      position="relative"
      overflowX="hidden"
      $gtSm={{overflowX: "inherit"}}
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
        backgroundColor="$background"
      >
        <XStack // Rendered as YStack when isCenterLayout
          paddingVertical="$2"
          ai="center"
          paddingHorizontal="$4"
          minHeight={56}
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
  return (
    <>
      {docId && origin && originHomeId && originHomeId.uid !== docId.uid ? (
        <YStack padding="$2" alignItems="center" backgroundColor="$brand5">
          <SizableText color="white" size="$3">
            Hosted on{" "}
            <ButtonText color="white" tag="a" href="/">
              {hostnameStripProtocol(origin)}
            </ButtonText>{" "}
            via the{" "}
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
      userSelect="none"
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
      zIndex={2000}
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
