import {
  formattedDate,
  getFileUrl,
  HMDocument,
  HMDocumentListItem,
  HMEntityContent,
  hmId,
  useRouteLink,
} from "@shm/shared";
import {View} from "@tamagui/core";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {useMemo} from "react";
import {AccountsMetadata, FacePile} from "./face-pile";

export function BannerNewspaperCard({
  item,
  entity,
  accountsMetadata,
}: {
  item: HMDocumentListItem;
  entity: HMEntityContent | null | undefined;
  accountsMetadata: AccountsMetadata;
}) {
  const id = hmId("d", item.account, {path: item.path});
  // const navigate = useNavigate()
  const linkProps = useRouteLink({key: "document", id});

  if (!entity?.document) return null;
  return (
    <XStack
      {...baseCardStyles}
      marginTop="$4"
      //   onPress={() => {
      //     //   navigate({key: 'document', id})
      //   }}
      {...linkProps}
    >
      <View width="50%">
        <NewspaperCardImage document={entity.document} height="100%" />
      </View>
      <YStack flex={1} width="50%" jc="space-between">
        <NewspaperCardContent entity={entity} />
        <NewspaperCardFooter
          entity={entity}
          item={item}
          accountsMetadata={accountsMetadata}
        />
      </YStack>
    </XStack>
  );
}
function NewspaperCardImage({
  document,
  height = 120,
}: {
  document: HMDocument;
  height?: number | string;
}) {
  const coverImage = document.metadata.cover;
  return (
    <View
      height={height}
      // minHeight={120}
      // maxHeight={200}
      backgroundColor="$blue6"
    >
      {coverImage ? (
        <img
          src={getFileUrl(coverImage)}
          style={{minWidth: "100%", minHeight: "100%", objectFit: "cover"}}
        />
      ) : null}
    </View>
  );
}

function NewspaperCardContent({
  entity,
}: {
  entity: HMEntityContent | null | undefined;
}) {
  let textContent = useMemo(() => {
    if (entity?.document?.content) {
      let content = "";
      entity?.document?.content.forEach((bn) => {
        content += bn.block?.text + " ";
      });
      return content;
    }
  }, [entity?.document]);
  return (
    <YStack padding="$3" gap="$3" f={1}>
      <SizableText size="$5" fontWeight="bold">
        {entity?.document?.metadata?.name}
      </SizableText>
      <YStack overflow="hidden" maxHeight={21 * 3}>
        <SizableText color="$color10" fontFamily="$editorBody" size="$2">
          {textContent}
        </SizableText>
      </YStack>
    </YStack>
  );
}

function NewspaperCardFooter({
  item,
  entity,
  accountsMetadata,
}: {
  item: HMDocumentListItem;
  entity: HMEntityContent | null | undefined;
  accountsMetadata: AccountsMetadata;
}) {
  return (
    <XStack
      jc="space-between"
      alignSelf="stretch"
      backgroundColor="$background"
      paddingHorizontal="$4"
      paddingVertical="$2"
      alignItems="center"
    >
      {entity?.document?.updateTime && (
        <SizableText size="$1">
          {formattedDate(entity?.document?.updateTime)}
        </SizableText>
      )}
      <XStack>
        <FacePile
          accounts={entity?.document?.authors || []}
          accountsMetadata={accountsMetadata}
        />
      </XStack>
    </XStack>
  );
}
const baseCardStyles: Parameters<typeof XStack>[0] = {
  borderRadius: "$4",
  backgroundColor: "$backgroundStrong",
  shadowColor: "$shadowColor",
  shadowOffset: {width: 0, height: 2},
  shadowRadius: 8,
  overflow: "hidden",
  hoverStyle: {
    backgroundColor: "$blue2",
  },
};
export function NewspaperCard({
  item,
  entity,
  accountsMetadata,
}: {
  item: HMDocumentListItem;
  entity: HMEntityContent | null | undefined;
  accountsMetadata: AccountsMetadata;
}) {
  const id = hmId("d", item.account, {path: item.path});
  const linkProps = useRouteLink({key: "document", id});

  // const navigate = useNavigate()
  if (!entity?.document) return null;
  return (
    <YStack
      {...baseCardStyles}
      //   marginTop="$4"
      //   marginTop="$4"
      width={208}
      //   maxWidth={208}
      //   f={1}
      //   onPress={() => {
      //     //   navigate({key: 'document', id})
      //   }}
      {...linkProps}
    >
      <NewspaperCardImage document={entity.document} />
      <NewspaperCardContent entity={entity} />

      <NewspaperCardFooter
        entity={entity}
        item={item}
        accountsMetadata={accountsMetadata}
      />
    </YStack>
  );
}
