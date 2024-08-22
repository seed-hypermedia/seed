import {MetaFunction} from "@remix-run/node";
import {HMDocument} from "@shm/shared";
import {Container} from "@shm/ui/src/container";
import {DocContent, DocContentProvider} from "@shm/ui/src/document-content";
import {YStack} from "@tamagui/stacks";
import {deserialize} from "superjson";
import type {hmDocumentLoader, hmDocumentPayload} from "./loaders";
import {PageHeader} from "./page-header";

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
      />
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
    </YStack>
  );
}
