import {HMDocument} from "@shm/shared";
import {DocContent, DocContentProvider} from "@shm/ui/src/document-content";
import {XStack, YStack} from "@tamagui/stacks";
import {Heading} from "@tamagui/text";

export function DocumentPage({document}: {document: HMDocument}) {
  return (
    <XStack jc="center">
      <YStack width="100%" maxWidth={900} marginVertical="$6">
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
