import {MetaFunction} from "@remix-run/node";
import {useFetcher} from "@remix-run/react";
import {HMDocument, UnpackedHypermediaId} from "@shm/shared";
import {Container} from "@shm/ui/src/container";
import {DocContent, DocContentProvider} from "@shm/ui/src/document-content";
import {RadioButtons} from "@shm/ui/src/radio-buttons";
import {Text} from "@tamagui/core";
import {YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {useEffect, useState} from "react";
import {deserialize} from "superjson";
import type {hmDocumentLoader, hmDocumentPayload} from "./loaders";
import {PageHeader} from "./page-header";
import type {HMDirectory} from "./routes/hm.api.directory";
import {unwrap, Wrapped} from "./wrapping";

export const documentPageMeta: MetaFunction<hmDocumentLoader> = ({data}) => {
  const document = deserialize(data?.document) as HMDocument;
  return [{title: document.metadata?.name || "Untitled"}];
};

export function DocumentPage(props: hmDocumentPayload) {
  const document = deserialize(props.document) as HMDocument;
  return (
    <YStack>
      <PageHeader
        homeMetadata={props.homeMetadata}
        homeId={props.homeId}
        docMetadata={document.metadata}
        docId={props.id}
        authors={props.authors}
        updateTime={document.updateTime}
      />
      <YStack>
        {/* <YStack display="none" h={0} $gtSm={{display: "block"}} bg="green">
          <YStack position="sticky" w={100} h={100} top={50} bg="red" zi={10} />
        </YStack> */}
        <Container clearVerticalSpace>
          <DocContentProvider
            entityComponents={{
              Document: () => null,
              Comment: () => null,
              Inline: () => null,
            }}
            ipfsBlobPrefix="http://localhost:55001/ipfs/" // todo, configure this properly
            onLinkClick={(href, e) => {}}
            onCopyBlock={(blockId, blockRange) => {}}
            saveCidAsFile={async (cid, name) => {}}
            textUnit={18}
            layoutUnit={24}
            debug={false}
          >
            <DocContent document={document} />
          </DocContentProvider>
        </Container>
        <OutlineSheet document={document} />
      </YStack>
    </YStack>
  );
}

function DocumentAppendix({id}: {id: UnpackedHypermediaId}) {
  const [activeTab, setActiveTab] = useState<"directory" | "discussion">(
    "directory"
  );
  let content = null;
  if (activeTab === "directory") {
    content = <DocumentDirectory id={id} />;
  } else if (activeTab === "discussion") {
    content = <DocumentDiscussion id={id} />;
  }
  return (
    <Container>
      <RadioButtons
        value={activeTab}
        options={
          [
            {key: "discussion", label: "Discussion"},
            {key: "directory", label: "Directory"},
          ] as const
        }
        onValue={setActiveTab}
      />
      {content}
    </Container>
  );
}

function DocumentDirectory({id}: {id: UnpackedHypermediaId}) {
  const fetcher = useFetcher<Wrapped<HMDirectory>>();
  useEffect(() => {
    fetcher.load(`/hm/api/directory?id=${id.id}`);
  }, []);
  const directory = unwrap<HMDirectory>(fetcher.data);
  return directory?.documents.map((doc) => <Text>{doc.metadata?.name}</Text>);
  // return <Text>{JSON.stringify(fetcher.data?.id)}</Text>;
}

function DocumentDiscussion({id}: {id: UnpackedHypermediaId}) {
  return null;
}

function OutlineSheet({document}: {document?: HMDocument}) {
  if (!document) return null;
  return <SizableText>demo</SizableText>;
}
