import {MetaFunction} from "@remix-run/node";
import {useFetcher} from "@remix-run/react";
import {HMDocument, UnpackedHypermediaId} from "@shm/shared";
import {Container} from "@shm/ui/src/container";
import {DocContent, DocContentProvider} from "@shm/ui/src/document-content";
import {RadioButtons} from "@shm/ui/src/radio-buttons";
import {Text} from "@tamagui/core";
import {
  Sheet,
  Frame as SheetFrame,
  Handle as SheetHandle,
  Overlay as SheetOverlay,
  SheetScrollView,
} from "@tamagui/sheet";
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

const outlineWidth = 172;
export function DocumentPage(props: hmDocumentPayload) {
  const document = deserialize(props.document) as HMDocument;
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(0);

  return (
    <YStack>
      <PageHeader
        homeMetadata={props.homeMetadata}
        homeId={props.homeId}
        docMetadata={document.metadata}
        docId={props.id}
        authors={props.authors}
        updateTime={document.updateTime}
        openSheet={() => {
          console.log("OPEN SHEET", open);
          setOpen(!open);
        }}
      />
      <YStack position="relative">
        <Container clearVerticalSpace>
          <YStack
            position="absolute"
            h="100%"
            top={0}
            left={outlineWidth * -1}
            display="none"
            $gtMd={{display: "flex"}}
          >
            <YStack
              width={outlineWidth}
              position="sticky"
              paddingTop={34}
              top={0}
              h="calc(100%)"
              maxHeight="calc(100vh - 60px)"
              overflow="hidden"
              display="none"
              $gtSm={{display: "block"}}
            >
              <YStack
                gap="$3"
                maxHeight="100%"
                overflow="auto"
                className="hide-scrollbar"
              >
                <SizableText color="$color9" fontSize={14}>
                  TODO ERIC: OUTLINE HERE
                </SizableText>
              </YStack>
            </YStack>
          </YStack>
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
        <Sheet
          forceRemoveScrollEnabled={open}
          modal
          open={open}
          onOpenChange={setOpen}
          snapPoints={[45, 80]}
          dismissOnSnapToBottom
          position={position}
          onPositionChange={setPosition}
          zIndex={100_000}
          animation="medium"
        >
          <SheetOverlay
            position="absolute"
            top={0}
            zi={0}
            left={0}
            fullscreen
            animation="medium"
            enterStyle={{opacity: 0}}
            exitStyle={{opacity: 0}}
          />
          <SheetHandle />
          <SheetFrame>
            <SheetScrollView>
              <YStack bg="$background" padding="$4" marginInline="$6">
                <SizableText color="$color9" fontSize={14}>
                  TODO ERIC: OUTLINE HERE
                </SizableText>
              </YStack>
            </SheetScrollView>
          </SheetFrame>
        </Sheet>
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
