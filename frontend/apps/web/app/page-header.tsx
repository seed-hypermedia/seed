import {
  formattedDateMedium,
  HMDocument,
  hmId,
  HMMetadata,
  HMMetadataPayload,
  HMQueryResult,
  normalizeDate,
  relativeFormattedDate,
  UnpackedHypermediaId,
} from "@shm/shared";
import {Container} from "@shm/ui/src/container";
import {HMIcon} from "@shm/ui/src/hm-icon";
import {SiteLogo} from "@shm/ui/src/site-logo";
import {Popover} from "@shm/ui/src/TamaguiPopover";
import {MobileMenu, NewsSiteHeader} from "@shm/ui/src/top-bar";
import {usePopoverState} from "@shm/ui/src/use-popover-state";
import {Button} from "@tamagui/button";
import {Menu} from "@tamagui/lucide-icons";
import {Separator} from "@tamagui/separator";
import {XStack, YStack} from "@tamagui/stacks";
import {H1, SizableText} from "@tamagui/text";
import {useMemo, useState} from "react";
import {ScrollView} from "react-native";
import {getHref} from "./href";
import {useDocumentChanges, useEntity} from "./models";
import {HMDocumentChangeInfo} from "./routes/hm.api.changes";
import {SearchUI} from "./search";

export function PageHeader({
  homeId,
  docMetadata,
  docId,
  authors = [],
  updateTime = null,
}: {
  homeId: UnpackedHypermediaId | null;
  docMetadata: HMMetadata | null;
  docId: UnpackedHypermediaId | null;
  authors: HMMetadataPayload[];
  updateTime: HMDocument["updateTime"] | null;
}) {
  const hasCover = useMemo(() => !!docMetadata?.cover, [docMetadata]);
  const hasIcon = useMemo(() => !!docMetadata?.icon, [docMetadata]);
  const isHomeDoc = useMemo(() => docId?.id == homeId?.id, [docId, homeId]);

  return (
    <YStack id="page-header">
      <Container
        $gtSm={{
          marginTop: hasCover ? -40 : 0,
          paddingTop: !hasCover ? 60 : "$6",
        }}
        $gtLg={{maxWidth: 1200}}
        backgroundColor="$background"
        borderTopLeftRadius="$2"
        borderTopRightRadius="$2"
      >
        <YStack>
          {!isHomeDoc && docId && hasIcon ? (
            <XStack marginTop={hasCover ? -80 : 0}>
              <HMIcon size={100} id={docId} metadata={docMetadata} />
            </XStack>
          ) : null}
          <H1 size="$9" style={{fontWeight: "bold"}}>
            {docMetadata?.name}
          </H1>
          <XStack
            marginBlock="$4"
            gap="$3"
            alignItems="center"
            flex={1}
            flexWrap="wrap"
          >
            {authors?.length ? (
              <XStack
                alignItems="center"
                gap={0}
                flexWrap="wrap"
                maxWidth="100%"
              >
                {authors.flatMap((a, index) => [
                  <SizableText
                    hoverStyle={{
                      textDecorationLine: "underline",
                    }}
                    fontWeight="bold"
                    size="$2"
                    key={a.id.id}
                  >
                    {a.metadata.name}
                  </SizableText>,
                  index !== authors.length - 1 ? (
                    index === authors.length - 2 ? (
                      <SizableText key={`${a}-and`} size="$2" fontWeight="bold">
                        {" & "}
                      </SizableText>
                    ) : (
                      <SizableText
                        size="$2"
                        key={`${a}-comma`}
                        fontWeight="bold"
                      >
                        {", "}
                      </SizableText>
                    )
                  ) : null,
                ])}
              </XStack>
            ) : null}
            {authors?.length ? <VerticalSeparator /> : null}
            {docId ? (
              <VersionsModal
                homeId={homeId}
                docId={docId}
                updateTime={updateTime}
              />
            ) : null}
            {/* {docId && <DonateButton docId={docId} authors={authors} />} */}
          </XStack>
          <Separator />
        </YStack>
      </Container>
    </YStack>
  );
}

export function SiteHeader(props: {
  homeMetadata: HMMetadata | null;
  homeId: UnpackedHypermediaId | null;
  docMetadata: HMMetadata | null;
  docId: UnpackedHypermediaId | null;
  openSheet?: () => void;
  breadcrumbs: Array<{
    id: UnpackedHypermediaId;
    metadata: HMMetadata;
  }>;
  supportQueries?: HMQueryResult[];
  children: React.JSX.Element;
  mobileSearchUI?: React.ReactNode;
  isWeb?: boolean;
}) {
  if (props.homeMetadata?.layout === "Seed/Experimental/Newspaper") {
    const supportQuery = props.supportQueries?.find(
      (q) => q.in.uid === props.homeId?.uid
    );
    const items = supportQuery?.results
      ?.filter((item) => {
        return item.path.length === 1;
      })
      ?.map((item) => {
        const sortTime = normalizeDate(item.createTime);
        if (!sortTime) return null;
        return {
          isPublished: true,
          isDraft: false,
          id: hmId("d", item.account, {path: item.path}),
          sortTime,
          metadata: item.metadata,
        };
      })
      .filter((item) => !!item);
    items
      ?.sort((a, b) => b.sortTime.getTime() - a.sortTime.getTime())
      .reverse();
    return (
      <NewsSiteHeader
        {...props}
        items={items || []}
        searchUI={props.homeId ? <SearchUI homeId={props.homeId} /> : null}
      />
    );
  }
  return (
    <DefaultSiteHeader
      {...props}
      searchUI={props.homeId ? <SearchUI homeId={props.homeId} /> : null}
    />
  );
}

export function DefaultSiteHeader({
  homeMetadata,
  homeId,
  children,
  searchUI,
  mobileSearchUI,
  isWeb = false,
}: {
  homeMetadata: HMMetadata | null;
  homeId: UnpackedHypermediaId | null;
  children: React.JSX.Element;
  searchUI?: React.ReactNode;
  mobileSearchUI?: React.ReactNode;
  isWeb?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <XStack
        paddingHorizontal="$4"
        paddingVertical="$2.5"
        alignItems="center"
        borderBottomWidth={1}
        borderColor="$borderColor"
        gap="$4"
        zIndex="$zIndex.7"
        // @ts-ignore
        position="sticky"
        top={0}
        right={0}
        left={0}
        backgroundColor="$background"
      >
        {homeId ? <SiteLogo id={homeId} metadata={homeMetadata} /> : null}
        {/* <XStack alignItems="center" gap="$2">
          {homeMetadata?.icon && homeId ? (
            <HMIcon size={30} id={homeId} metadata={homeMetadata} />
          ) : null}

          <SizableText fontWeight="bold">
            {homeMetadata?.name || "Seed Gateway"}
          </SizableText>
        </XStack> */}
        <XStack flex={1} />
        {isWeb ? (
          <>
            <Button
              $gtSm={{display: "none"}}
              icon={<Menu size={20} />}
              chromeless
              size="$2"
              onPress={() => {
                setOpen(true);
              }}
            />
            {searchUI}
          </>
        ) : null}
      </XStack>
      {isWeb ? (
        <MobileMenu
          open={open}
          onClose={() => setOpen(false)}
          mobileSearchUI={mobileSearchUI}
        >
          {children}
        </MobileMenu>
      ) : null}
    </>
  );
}

function VersionsModal({
  homeId,
  docId,
  updateTime,
}: {
  homeId: UnpackedHypermediaId | null;
  docId: UnpackedHypermediaId;
  updateTime: HMDocument["updateTime"] | null;
}) {
  const entity = useEntity(docId);
  const popoverState = usePopoverState();

  const changes = useDocumentChanges(docId);

  return updateTime && !changes.isLoading ? (
    <Popover {...popoverState}>
      <Popover.Trigger
        color="$color9"
        flexDirection="row"
        gap="$2"
        hoverStyle={{color: "$color12"}}
      >
        <SizableText flexShrink={0} flexGrow={0} size="$1" color="inherit">
          {formattedDateMedium(entity.data?.document?.updateTime)}
        </SizableText>
        {changes.data && changes.data.length > 1 ? (
          <SizableText size="$1" flexShrink={0} flexGrow={0} color="inherit">
            ({changes.data?.length} versions)
          </SizableText>
        ) : null}
      </Popover.Trigger>
      {changes.data && changes.data.length > 1 ? (
        <Popover.Content
          borderWidth={1}
          borderColor="$borderColor"
          enterStyle={{y: -10, opacity: 0}}
          exitStyle={{y: -10, opacity: 0}}
          elevation="$5"
          padding="$2"
          animation={[
            "fast",
            {
              opacity: {
                overshootClamping: true,
              },
            },
          ]}
        >
          <Popover.Arrow borderWidth={1} borderColor="$borderColor" />
          <YStack overflow="hidden" maxHeight={220}>
            <ScrollView>
              {changes?.data?.map((change) => {
                let href = homeId
                  ? getHref(homeId, docId, change.id)
                  : undefined;

                return (
                  <ModalVersionItem
                    href={href}
                    key={change.id}
                    change={change}
                  />
                );
              })}
            </ScrollView>
          </YStack>
        </Popover.Content>
      ) : null}
    </Popover>
  ) : null;

  /**
   * <Tooltip
      content={`Update time: ${formattedDateLong(
        entity.data?.document?.updateTime,
      )}`}
    >
      <SizableText
        flexShrink={0}
        flexGrow={0}
        size="$1"
        hoverStyle={{cursor: 'default'}}
        color="$color9"
      >
        {formattedDateMedium(entity.data?.document?.updateTime)}
      </SizableText>
    </Tooltip>
   */
}

function ModalVersionItem({
  change,
  href,
}: {
  change: HMDocumentChangeInfo;
  href?: string;
}) {
  return (
    <Button
      tag="a"
      role="link"
      key={change.id}
      height="auto"
      padding="$2"
      href={href}
      onPress={() => {
        console.log(`== ~ {ModalVersionItem ~ href:`, href);
      }}
      borderRadius="$2"
      borderWidth={0}
      backgroundColor={"$backgroundTransparent"}
      hoverStyle={{
        backgroundColor: "$brand12",
        borderColor: "$borderTransparent",
      }}
      alignItems="flex-start"
      position="relative"
      overflow="hidden"
      maxWidth={260}
      style={{textDecoration: "none"}}
      icon={
        <HMIcon
          flexGrow={0}
          flexShrink={0}
          size={20}
          id={change.author.id}
          metadata={change.author.metadata}
        />
      }
    >
      <SizableText
        size="$2"
        flex={1}
        flexShrink={1}
        textOverflow="ellipsis"
        overflow="hidden"
        whiteSpace="nowrap"
      >
        {change.author.metadata.name}
      </SizableText>
      <SizableText size="$2" whiteSpace="nowrap" flexShrink={0}>
        {relativeFormattedDate(change.createTime)}
      </SizableText>
    </Button>
  );
}

const VerticalSeparator = () => (
  <XStack flexShrink={0} flexGrow={0} width={1} height={20} bg="$color8" />
);

function Breadcrumbs({
  breadcrumbs,
  homeId,
  docId,
  docMetadata,
}: {
  breadcrumbs: Array<{
    id: UnpackedHypermediaId;
    metadata: HMMetadata;
  }>;
  homeId?: UnpackedHypermediaId;
  docId?: UnpackedHypermediaId;
  docMetadata?: HMMetadata;
}) {
  const displayBreadcrumbs = breadcrumbs.filter((breadcrumb) => {
    if (
      !breadcrumb.id.path?.length &&
      homeId &&
      breadcrumb.id.uid === homeId.uid
    )
      return null;
  });
  return (
    <XStack flex={1} gap="$2">
      {displayBreadcrumbs.flatMap((crumb) => {
        return [
          <SizableText
            tag="a"
            key={crumb.id.id}
            href={getHref(homeId, crumb.id)}
            size="$1"
            fontWeight="bold"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            minWidth="8ch"
          >
            {crumb.metadata?.name}
          </SizableText>,
          <SizableText key={`${crumb.id.id}-slash`} size="$1">
            /
          </SizableText>,
        ];
      })}
      {docId?.id != homeId?.id ? (
        <SizableText
          size="$1"
          fontWeight="bold"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          // flex={1}
        >
          {docMetadata?.name}
        </SizableText>
      ) : null}
    </XStack>
  );
}
