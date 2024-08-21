import {MetaFunction} from "@remix-run/node";
import {HMDocument} from "@shm/shared";
import {DocContent, DocContentProvider} from "@shm/ui/src/document-content";
import {XStack, YStack} from "@tamagui/stacks";
import {Heading} from "@tamagui/text";
import {deserialize} from "superjson";
import type {hmDocumentLoader, hmDocumentPayload} from "./loaders";

export const documentPageMeta: MetaFunction<hmDocumentLoader> = ({data}) => {
  const document = deserialize(data.document) as HMDocument;
  return [{title: document.metadata?.name || "Untitled"}];
};

export function DocumentPage(props: hmDocumentPayload) {
  const document = deserialize(props.document) as HMDocument;
  return (
    <XStack jc="center">
      <YStack width="100%" maxWidth={900} marginVertical="$6">
        <Heading size="$6" paddingHorizontal="$4">
          {props.homeDocumentMetadata?.name}
        </Heading>
        <Heading size="$10" paddingHorizontal="$4">
          {document.metadata?.name}
        </Heading>
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
      </YStack>
    </XStack>
  );
}
