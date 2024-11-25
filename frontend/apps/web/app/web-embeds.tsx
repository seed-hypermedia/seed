import {useNavigate} from "@remix-run/react";
import {
  createWebHMUrl,
  getDocumentTitle,
  hmId,
  UnpackedHypermediaId,
} from "@shm/shared";
import {
  ContentEmbed,
  EntityComponentProps,
  ErrorBlock,
  InlineEmbedButton,
} from "@shm/ui/src/document-content";
import {HMIcon} from "@shm/ui/src/hm-icon";
import {NewspaperCard} from "@shm/ui/src/newspaper";
import {Spinner} from "@shm/ui/src/spinner";
import {Text} from "@tamagui/core";
import {YStack} from "@tamagui/stacks";
import {useState} from "react";
import {SizableText} from "tamagui";
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

export function QueryBlockWeb(props: EntityComponentProps) {
  console.log(`== ~ QueryBlockWeb ~ props:`, props);
  return <SizableText>Query Block</SizableText>;
}
