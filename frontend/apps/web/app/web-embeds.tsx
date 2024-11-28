import {useNavigate} from "@remix-run/react";
import {
  createWebHMUrl,
  formattedDate,
  getDocumentTitle,
  HMBlockQuery,
  hmId,
  hmIdPathToEntityQueryPath,
  HMQueryResult,
  HMQuerySort,
  UnpackedHypermediaId,
} from "@shm/shared";
import {Button} from "@shm/ui/src/button";
import {
  ContentEmbed,
  EntityComponentProps,
  ErrorBlock,
  InlineEmbedButton,
  useDocContentContext,
} from "@shm/ui/src/document-content";
import {HMIcon} from "@shm/ui/src/hm-icon";
import {NewspaperCard} from "@shm/ui/src/newspaper";
import {Spinner} from "@shm/ui/src/spinner";
import {StackProps, Text} from "@tamagui/core";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {useMemo, useState} from "react";
import {useEntity} from "./models";

function EmbedWrapper({
  id,
  parentBlockId,
  hideBorder = false,
  children,
}: React.PropsWithChildren<{
  id: UnpackedHypermediaId;
  parentBlockId: string | null;
  hideBorder?: boolean;
}>) {
  const navigate = useNavigate();
  return (
    <YStack
      width="100%"
      borderRightWidth={hideBorder ? 0 : 3}
      borderRightColor={hideBorder ? "$colorTransparent" : "$brand8"}
      onPress={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigate(
          createWebHMUrl(id.type, id.uid, {
            hostname: null,
            blockRange: id.blockRange,
            blockRef: id.blockRef,
            version: id.version,
            latest: id.latest,
            path: id.path,
          })
        );
      }}
    >
      {children}
    </YStack>
  );
}

export function EmbedDocument(props: EntityComponentProps) {
  if (props.block.type !== "Embed") return null;
  if (props.block.attributes?.view == "Card") {
    return <EmbedDocumentCard {...props} />;
  } else {
    return <EmbedDocContent {...props} />;
  }
}

export function HMIconComponent({accountId}: {accountId?: string | undefined}) {
  const id = accountId ? hmId("d", accountId) : undefined;
  const entity = useEntity(id);
  if (!id) return null;
  return (
    <HMIcon size={20} id={id} metadata={entity.data?.document?.metadata} />
  );
}

export function EmbedInline(props: EntityComponentProps) {
  if (props?.type == "d") {
    return <DocInlineEmbed {...props} />;
  } else {
    console.error("Inline Embed Error", JSON.stringify(props));
    return <Text>?</Text>;
  }
}

function DocInlineEmbed(props: EntityComponentProps) {
  const pubId = props?.type == "d" ? props.id : undefined;
  if (!pubId) throw new Error("Invalid props at DocInlineEmbed (pubId)");
  const doc = useEntity(props);
  const document = doc.data?.document;
  return (
    <InlineEmbedButton id={props}>
      @{document ? getDocumentTitle(document) : "..."}
    </InlineEmbedButton>
  );
}

export function EmbedDocumentCard(props: EntityComponentProps) {
  const doc = useEntity(props);
  if (doc.isLoading) return <Spinner />;
  if (!doc.data) return <ErrorBlock message="Could not load embed" />;
  return (
    <EmbedWrapper id={props} parentBlockId={props.parentBlockId} hideBorder>
      <NewspaperCard
        isWeb
        entity={{
          id: props,
          document: doc.data.document,
        }}
        id={props}
        accountsMetadata={doc.data.authors}
      />
    </EmbedWrapper>
  );
}

export function EmbedDocContent(props: EntityComponentProps) {
  const [showReferenced, setShowReferenced] = useState(false);
  const doc = useEntity(props);
  // return <div>{JSON.stringify(doc.data)}</div>;
  return (
    <ContentEmbed
      props={props}
      isLoading={doc.isLoading}
      showReferenced={showReferenced}
      onShowReferenced={setShowReferenced}
      document={doc.data?.document}
      EmbedWrapper={EmbedWrapper}
      parentBlockId={props.parentBlockId}
      renderOpenButton={
        () => null
        //   <Button
        //     size="$2"
        //     icon={ArrowUpRightSquare}
        //     onPress={() => {
        //       if (!props.id) return
        //       navigate({
        //         key: 'document',
        //         id: props,
        //       })
        //     }}
        //   >
        //     Open Document
        //   </Button>
      }
    />
  );
}

function sortQueryBlockResults(
  queryResults: HMQueryResult | undefined,
  sort: HMQuerySort
) {
  return queryResults;
}

export function QueryBlockWeb({
  id,
  block,
}: {
  id: UnpackedHypermediaId;
  block: HMBlockQuery;
}) {
  const ctx = useDocContentContext();
  // const query
  const {supportQueries, supportDocuments} = ctx || {};
  const includes = block.attributes.query.includes || [];
  const queryInclude = includes[0];
  if (!queryInclude || includes.length !== 1)
    return (
      <ErrorBlock message="Only one QueryBlock.attributes.query.includes is supported for now" />
    );

  const queryResults = supportQueries?.find((q) => {
    if (q.in.uid !== queryInclude.space) return false;
    const path = hmIdPathToEntityQueryPath(q.in.path);
    if (path !== queryInclude.path) return false;
    if (q.mode !== queryInclude.mode) return false;
    return true;
  });
  // const sorted = sortQueryBlockResults(queryResults, block.attributes.query.sort);
  // queryResults?.results.map(resu)
  // return queryResults?.results
  const DataComponent =
    block.attributes.style == "List" ? QueryListStyle : QueryCardStyle;

  return <DataComponent block={block} queryResults={queryResults} />;
}

function QueryCardStyle({
  block,
  queryResults,
}: {
  block: HMBlockQuery;
  queryResults?: HMQueryResult;
}) {
  const ctx = useDocContentContext();

  const columnProps = useMemo(() => {
    switch (block.attributes.columnCount) {
      case 2:
        return {
          flexBasis: "100%",
          $gtSm: {flexBasis: "50%"},
          $gtMd: {flexBasis: "50%"},
        } as StackProps;
      case 3:
        return {
          flexBasis: "100%",
          $gtSm: {flexBasis: "50%"},
          $gtMd: {flexBasis: "33.333%"},
        } as StackProps;
      default:
        return {
          flexBasis: "100%",
          $gtSm: {flexBasis: "100%"},
          $gtMd: {flexBasis: "100%"},
        } as StackProps;
    }
  }, [block.attributes.columnCount]);

  return (
    <XStack f={1} flexWrap="wrap" marginHorizontal="$-3">
      {queryResults?.results?.map((item) => {
        const id = hmId("d", item.account, {
          path: item.path,
          latest: true,
        });
        return (
          <YStack {...columnProps} p="$3">
            <NewspaperCard
              id={id}
              entity={{
                id,
                document: {metadata: item.metadata},
              }}
              key={item.path.join("/")}
              accountsMetadata={
                ctx.supportDocuments?.map((d) => ({
                  id: d.id,
                  metadata: d.document?.metadata,
                })) || []
              }
              flexBasis="100%"
              $gtSm={{flexBasis: "100%"}}
              $gtMd={{flexBasis: "100%"}}
            />
          </YStack>
        );
      })}
    </XStack>
  );
}

function QueryListStyle({
  block,
  queryResults,
}: {
  block: HMBlockQuery;
  queryResults?: HMQueryResult;
}) {
  const navigate = useNavigate();

  return (
    <YStack gap="$3" w="100%">
      {queryResults?.results?.map((item) => {
        const id = hmId("d", item.account, {
          path: item.path,
          latest: true,
        });
        const icon =
          id.path?.length == 0 || item.metadata?.icon ? (
            <HMIcon size={28} id={id} metadata={item.metadata} />
          ) : null;
        return (
          <Button
            borderWidth={0}
            backgroundColor="$colorTransparent"
            hoverStyle={{
              backgroundColor: "$color5",
            }}
            elevation="$1"
            paddingHorizontal={16}
            paddingVertical="$1"
            h={60}
            icon={icon}
            onPress={() => {
              navigate(
                createWebHMUrl(id.type, id.uid, {
                  hostname: null,
                  blockRange: id.blockRange,
                  blockRef: id.blockRef,
                  version: id.version,
                  latest: id.latest,
                  path: id.path,
                })
              );
            }}
          >
            <XStack
              gap="$2"
              alignItems="center"
              flex={1}
              paddingVertical="$2"
              bg="red"
            >
              <SizableText
                fontWeight="bold"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
                overflow="hidden"
              >
                {item.metadata.name}
              </SizableText>
            </XStack>
            <SizableText size="$1" color="$color10">
              {formattedDate(item.updateTime)}
            </SizableText>
          </Button>
        );
      })}
    </YStack>
  );
}
