import {
  getMetadataName,
  HMMetadata,
  UnpackedHypermediaId,
  useRouteLink,
} from "@shm/shared";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import React, {useEffect, useState} from "react";
import {Button} from "./button";
import {Close, Menu} from "./icons";
import {SiteLogo} from "./site-logo";
import {SiteNavigationDocument} from "./site-navigation";

export function NewsSiteHeader({
  homeMetadata,
  homeId,
  rightContent,
  docId,
  afterLinksContent,
  searchUI,
  mobileSearchUI,
  renderMobileMenu,
  isWeb = false,
  items,
}: {
  homeMetadata: HMMetadata | null;
  homeId: UnpackedHypermediaId | null;
  rightContent?: React.ReactNode;
  docId: UnpackedHypermediaId | null;
  afterLinksContent?: React.ReactNode;
  searchUI?: React.ReactNode;
  mobileSearchUI?: React.ReactNode;
  renderMobileMenu: (props: {
    onSetOpen: (open: boolean) => void;
  }) => React.JSX.Element;
  isWeb?: boolean;
  items?: SiteNavigationDocument[];
}) {
  const [open, setOpen] = useState(false);
  if (!homeId) return null;
  return (
    <>
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
        <HomeHeader
          onOpen={() => setOpen(true)}
          homeId={homeId}
          homeMetadata={homeMetadata}
          rightContent={rightContent}
          searchUI={searchUI}
          isWeb={isWeb}
        />
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
                <NewsSiteHeaderLink
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
      </YStack>
      {isWeb ? (
        <MobileMenu
          open={open}
          onClose={() => setOpen(false)}
          mobileSearchUI={mobileSearchUI}
          renderMobileMenu={renderMobileMenu}
        />
      ) : null}
    </>
  );
}

function HomeHeader({
  homeMetadata,
  homeId,
  rightContent,
  searchUI,
  onOpen,
  isWeb = false,
}: {
  homeMetadata: HMMetadata | null;
  homeId: UnpackedHypermediaId;
  rightContent?: React.ReactNode;
  searchUI?: React.ReactNode;
  onOpen: () => void;
  isWeb?: boolean;
}) {
  return (
    <XStack paddingHorizontal="$4" paddingVertical="$2.5" ai="center" gap="$4">
      {isWeb ? <XStack w={38} /> : null}
      <XStack ai="center" jc="center" f={1}>
        <SiteLogo id={homeId} metadata={homeMetadata} />
      </XStack>
      <XStack
        ai="center"
        gap="$3"
        position="absolute"
        right="$4"
        top={0}
        height="100%"
        background="$background"
      >
        {rightContent}
      </XStack>
      {isWeb ? (
        <>
          <Button
            $gtSm={{display: "none"}}
            icon={<Menu size={20} />}
            chromeless
            size="$2"
            onPress={() => {
              onOpen();
            }}
          />
          <XStack display="none" $gtSm={{display: "flex"}}>
            {searchUI}
          </XStack>
        </>
      ) : null}
    </XStack>
  );
}

function NewsSiteHeaderLink({
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
  children,
  open,
  onClose,
  mobileSearchUI,
}: {
  children: React.JSX.Element;
  open: boolean;
  onClose: () => void;
  mobileSearchUI?: React.ReactNode;
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
      bg="$background"
      fullscreen
      // @ts-ignore
      position="fixed"
      top={0}
      right={0}
      bottom={0}
      zIndex="$zIndex.7"
      x={open ? 0 : "100%"}
      animation="fast"
    >
      <XStack p="$4" alignItems="center">
        <XStack f={1}>{mobileSearchUI}</XStack>
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
        {children}
      </YStack>
    </YStack>
  );
}
