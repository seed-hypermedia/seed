import {useFetcher} from "@remix-run/react";
import {ContentEmbed, EntityComponentProps} from "@shm/ui/src/document-content";
import {useEffect, useState} from "react";

function EmbedWrapper({
  children,
}: React.PropsWithChildren<{hmRef: string; parentBlockId: string}>) {
  return children;
}

export function EmbedDocument(props: EntityComponentProps) {
  if (props.block.attributes?.view == "card") {
    return null;
    // return <EmbedDocumentCard {...props} />;
  } else {
    return <EmbedDocContent {...props} />;
  }
}

export function EmbedDocContent(props: EntityComponentProps) {
  const [showReferenced, setShowReferenced] = useState(false);
  const doc = useEntity(props);
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

function useEntity(props: EntityComponentProps) {
  const fetcher = useFetcher();
  useEffect(() => {
    fetcher.load(`/hm/api/entity/${props.uid}/${props.path?.join("/")}`);
  }, [props.uid, props.path?.join("/")]);

  return {
    data: fetcher.data,
    isLoading: fetcher.state === "loading",
  };
}
