import {
  getMetadataName,
  HMDocument,
  HMEntityContent,
  HMMetadata,
  UnpackedHypermediaId,
  useRouteLink,
} from "@shm/shared";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import React, {useEffect, useState} from "react";
import {Button} from "./button";
import {Close, Menu} from "./icons";
import {DocumentOutline, SiteNavigationDocument} from "./navigation";
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
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const headerSearch = homeId ? (
    <XStack display="none" $gtSm={{display: "flex"}}>
      <HeaderSearch homeId={homeId} />
    </XStack>
  ) : null;
  console.log("iscenterlayout", isCenterLayout);
  if (!homeId) return null;
  return (
    <YStack position="relative">
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
        <XStack
          paddingHorizontal="$4"
          paddingVertical="$2"
          ai="center"
          gap="$2"
          flexDirection={isCenterLayout ? "column" : "row"}
        >
          <XStack
            ai="center"
            jc={isCenterLayout ? "center" : "flex-start"}
            alignSelf="stretch"
            f={1}
            // backgroundColor={isCenterLayout ? "red" : "yellow"}
          >
            <XStack f={1} jc="center">
              <SiteLogo
                id={homeId}
                metadata={homeMetadata}
                isCenterLayout={isCenterLayout}
              />
            </XStack>
            {isCenterLayout ? headerSearch : null}
          </XStack>
          <XStack
            ai="center"
            gap="$3"
            right="$4"
            height="100%"
            background="$background"
          >
            {items?.length || afterLinksContent ? (
              <XStack
                ai="center"
                gap="$2"
                padding="$2"
                jc="center"
                display="none"
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

          <Button
            $gtSm={{display: "none"}}
            icon={<Menu size={20} />}
            chromeless
            size="$2"
            onPress={() => {
              setIsMobileMenuOpen(true);
            }}
          />

          {isCenterLayout ? null : headerSearch}
          {headItems}
        </XStack>
      </YStack>
      {children}
      <MobileMenu
        open={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        renderContent={() => (
          <YStack>
            <MobileSearch homeId={homeId} />
            {docId && document && (
              <DocumentOutline
                onActivateBlock={() => {}}
                document={document}
                id={docId}
                // onCloseNav={() => {}}
                supportDocuments={supportDocuments}
                activeBlockId={docId.blockRef}
              />
            )}
          </YStack>
        )}
      />
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
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
  }, [open]);
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
        paddingBottom={200}
        flex={1}
        overflow="scroll"
        className="mobile-menu"
      >
        {open ? renderContent() : null}
      </YStack>
    </YStack>
  );
}
