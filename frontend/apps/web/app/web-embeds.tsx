import {useFetcher, useNavigate} from "@remix-run/react";
import {
  createWebHMUrl,
  getDocumentTitle,
  hmId,
  UnpackedHypermediaId,
} from "@shm/shared";
import {
  ContentEmbed,
  DocumentCardView,
  EntityComponentProps,
  InlineEmbedButton,
} from "@shm/ui/src/document-content";
import {Thumbnail} from "@shm/ui/src/thumbnail";
import {Text} from "@tamagui/core";
import {YStack} from "@tamagui/stacks";
import {useEffect, useMemo, useState} from "react";
import type {WebDocumentPayload} from "./loaders";
import {unwrap} from "./wrapping";

function EmbedWrapper({
  id,
  parentBlockId,
  children,
}: React.PropsWithChildren<{
  id: UnpackedHypermediaId;
  parentBlockId: string | null;
}>) {
  const navigate = useNavigate();
  return (
    <YStack
      cursor="pointer"
      onPress={() => {
        navigate(
          createWebHMUrl(id.type, id.uid, {
            hostname: null,
            blockRange: id.blockRange,
            blockRef: id.blockRef,
            version: id.version,
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
  if (props.block.attributes?.view == "card") {
    return <EmbedDocumentCard {...props} />;
  } else {
    return <EmbedDocContent {...props} />;
  }
}

export function ThumbnailComponent({
  accountId,
}: {
  accountId?: string | undefined;
}) {
  const id = accountId ? hmId("d", accountId) : undefined;
  const entity = useEntity(id);
  if (!id) return null;
  return (
    <Thumbnail size={20} id={id} metadata={entity.data?.document?.metadata} />
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
  return (
    <InlineEmbedButton id={props}>
      {getDocumentTitle(doc.data?.document)}
    </InlineEmbedButton>
  );
}

export function EmbedDocumentCard(props: EntityComponentProps) {
  const doc = useEntity(props);
  let textContent = useMemo(() => {
    if (doc.data?.document?.content) {
      let content = "";
      doc.data?.document?.content.forEach((bn) => {
        content += bn.block?.text + " ";
      });
      return content;
    }
  }, [doc.data]);

  return (
    <EmbedWrapper
      id={props}
      parentBlockId={props.parentBlockId}
      // viewType={props.block.attributes?.view == 'card' ? 'card' : 'content'}
    >
      <DocumentCardView
        title={getDocumentTitle(doc.data?.document)}
        textContent={textContent}
        editors={doc.data?.document?.authors || []}
        ThumbnailComponent={ThumbnailComponent}
        date={doc.data?.document?.updateTime}
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

function useEntity(id: UnpackedHypermediaId | undefined) {
  const fetcher = useFetcher();
  useEffect(() => {
    if (!id?.uid) return;
    const url = `/hm/api/entity/${id.uid}${
      id.path ? `/${id.path.join("/")}` : ""
    }`;
    fetcher.load(url);
  }, [id?.uid, id?.path?.join("/")]);

  return {
    data: fetcher.data ? unwrap<WebDocumentPayload>(fetcher.data) : null,
    isLoading: fetcher.state === "loading",
  };
}
