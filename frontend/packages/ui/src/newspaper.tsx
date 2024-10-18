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
    <View
      {...baseCardStyles}
      flexDirection="column"
      marginTop="$4"
      minHeight={340}
      $gtMd={{flexDirection: "row"}}
      {...linkProps}
    >
      <View height={200} width="100%" $gtMd={{width: "50%", height: "auto"}}>
        <NewspaperCardImage document={entity.document} height="100%" />
      </View>
      <YStack
        flex={1}
        width="100%"
        $gtMd={{width: "50%", height: "auto"}}
        jc="space-between"
      >
        <NewspaperCardContent banner entity={entity} />
        <NewspaperCardFooter
          banner
          entity={entity}
          item={item}
          accountsMetadata={accountsMetadata}
        />
      </YStack>
    </View>
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
  banner = false,
}: {
  entity: HMEntityContent | null | undefined;
  banner?: boolean;
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
    <YStack padding={banner ? "$5" : "$3"} gap="$3" f={1}>
      <SizableText size={banner ? "$8" : "$5"} fontWeight="bold">
        {entity?.document?.metadata?.name}
      </SizableText>
      <YStack overflow="hidden" maxHeight={(banner ? 27 : 21) * 3}>
        <SizableText
          color="$color10"
          fontFamily="$editorBody"
          size={banner ? "$4" : "$2"}
        >
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
      flexGrow={0}
      flexShrink={0}
      flexBasis="100%"
      $gtSm={{flexBasis: "48.5%"}}
      $gtMd={{flexBasis: "31.5%"}}
      {...baseCardStyles}
      marginTop="$5"
      //   marginTop="$4"

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
