import {
  formattedDateMedium,
  getMetadataName,
  HMDocument,
  HMMetadata,
  HMMetadataPayload,
  relativeFormattedDate,
  UnpackedHypermediaId,
} from "@shm/shared";
import {Container} from "@shm/ui/container";
import {DonateButton} from "@shm/ui/donate-button";
import {HMIcon} from "@shm/ui/hm-icon";
import {Popover} from "@shm/ui/TamaguiPopover";
import {usePopoverState} from "@shm/ui/use-popover-state";
import {Button, ButtonText} from "@tamagui/button";
import {Home} from "@tamagui/lucide-icons";
import {Separator} from "@tamagui/separator";
import {XStack, YStack} from "@tamagui/stacks";
import {H1, SizableText} from "@tamagui/text";
import {useMemo} from "react";
import {ScrollView} from "react-native";
import {getHref} from "./href";
import {useDocumentChanges} from "./models";
import {HMDocumentChangeInfo} from "./routes/hm.api.changes";

export function PageHeader({
  docMetadata,
  docId,
  authors = [],
  updateTime = null,
  breadcrumbs = [],
  originHomeId,
}: {
  docMetadata: HMMetadata | null;
  docId: UnpackedHypermediaId | null;
  authors: HMMetadataPayload[];
  updateTime: HMDocument["updateTime"] | null;
  breadcrumbs: Array<{
    id: UnpackedHypermediaId;
    metadata: HMMetadata;
  }>;
  originHomeId: UnpackedHypermediaId | null;
}) {
  const hasCover = useMemo(() => !!docMetadata?.cover, [docMetadata]);
  const hasIcon = useMemo(() => !!docMetadata?.icon, [docMetadata]);
  const isHomeDoc = !docId?.path?.length;
  return (
    <YStack id="page-header">
      <Container
        $gtSm={{
          marginTop: hasCover ? -40 : 0,
          paddingTop: !hasCover ? 60 : "$4",
        }}
        $gtLg={{maxWidth: 1200}}
        backgroundColor="$background"
        borderTopLeftRadius="$2"
        borderTopRightRadius="$2"
      >
        <YStack gap="$4">
          {!isHomeDoc && docId && hasIcon ? (
            <XStack marginTop={hasCover ? -80 : 0}>
              <HMIcon size={100} id={docId} metadata={docMetadata} />
            </XStack>
          ) : null}
          <Breadcrumbs breadcrumbs={breadcrumbs} originHomeId={originHomeId} />
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
                  <ButtonText
                    hoverStyle={{
                      textDecorationLine: "underline",
                      textDecorationColor: "currentColor",
                    }}
                    size="$2"
                    cursor="pointer"
                    fontWeight="bold"
                    key={a.id.id}
                    tag="a"
                    href={getHref(originHomeId, a.id)}
                    style={{textDecoration: "none"}}
                  >
                    {getMetadataName(a.metadata)}
                  </ButtonText>,
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
                originHomeId={originHomeId}
                docId={docId}
                updateTime={updateTime}
              />
            ) : null}
            {docId && <DonateButton docId={docId} authors={authors} />}
          </XStack>
          <Separator />
        </YStack>
      </Container>
    </YStack>
  );
}

function VersionsModal({
  originHomeId,
  docId,
  updateTime,
}: {
  originHomeId: UnpackedHypermediaId | null;
  docId: UnpackedHypermediaId;
  updateTime: HMDocument["updateTime"] | null;
}) {
  const popoverState = usePopoverState();
  const changes = useDocumentChanges(docId);
  return updateTime && !changes.isLoading ? (
    <Popover {...popoverState}>
      <Popover.Trigger
        color="$color9"
        flexDirection="row"
        gap="$2"
        cursor="pointer"
        hoverStyle={{color: "$color12"}}
      >
        <SizableText
          userSelect="none"
          flexShrink={0}
          flexGrow={0}
          size="$1"
          color="inherit"
        >
          {formattedDateMedium(updateTime)}
        </SizableText>
        {changes.data && changes.data.length > 1 ? (
          <SizableText
            size="$1"
            flexShrink={0}
            flexGrow={0}
            color="inherit"
            userSelect="none"
          >
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
                let href = originHomeId
                  ? getHref(originHomeId, docId, change.id)
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
  originHomeId,
}: {
  breadcrumbs: Array<{
    id: UnpackedHypermediaId;
    metadata: HMMetadata;
  }>;
  originHomeId: UnpackedHypermediaId | null;
}) {
  // const displayBreadcrumbs = breadcrumbs.filter((breadcrumb) => {
  //   if (
  //     !breadcrumb.id.path?.length &&
  //     homeId &&
  //     breadcrumb.id.uid === homeId.uid
  //   )
  //     return null;
  // });
  // const displayBreadcrumbs = breadcrumbs.filter((bc) => {
  //   console.log(`== ~ Breadcrumbs ~ bc:`, bc);
  //   return true;
  // });

  const [first, ...rest] = breadcrumbs;

  return (
    <XStack flex={1} gap="$2" alignItems="center">
      {first ? (
        <XStack alignItems="center" gap="$1">
          <Home color="$color10" size={12} />
          <SizableText
            color="$color10"
            tag="a"
            key={first.id.id}
            href={originHomeId ? getHref(originHomeId, first.id) : undefined}
            size="$1"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            textDecorationLine="none"
            hoverStyle={{
              textDecorationLine: "underline",
              textDecorationColor: "currentColor",
            }}
            maxWidth="15ch"
          >
            {first.metadata?.name}
          </SizableText>
        </XStack>
      ) : null}
      {rest.flatMap((crumb, index) => {
        return [
          <SizableText color="$color10" key={`${crumb.id.id}-slash`} size="$1">
            /
          </SizableText>,
          <SizableText
            color="$color10"
            tag="a"
            key={crumb.id.id}
            href={originHomeId ? getHref(originHomeId, crumb.id) : undefined}
            size="$1"
            textDecorationLine="none"
            overflow="hidden"
            hoverStyle={{
              textDecorationLine: "underline",
              textDecorationColor: "currentColor",
            }}
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            textDecoration="none"
            maxWidth="15ch"
            // minWidth="8ch"
          >
            {crumb.metadata?.name}
          </SizableText>,
        ];
      })}
      {/* {docId?.id != homeId?.id ? (
        <SizableText
          size="$1"
          // fontWeight="bold"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          // flex={1}
        >
          {docMetadata?.name}
        </SizableText>
      ) : null} */}
    </XStack>
  );
}
