import {YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {SiteDocumentPayload} from "./loaders";
import {Container} from "./ui/container";
export function NotFoundPage({homeMetadata, homeId}: SiteDocumentPayload) {
  return (
    <YStack>
      <Container>
        <YStack
          alignSelf="center"
          width={600}
          gap="$5"
          borderWidth={1}
          borderColor="$color8"
          borderRadius="$4"
          padding="$5"
          elevation="$4"
        >
          <SizableText size="$8" fontWeight="bold">
            Document Not Found
          </SizableText>
          <SizableText>This document is not on this server (yet).</SizableText>
        </YStack>
      </Container>
    </YStack>
  );
}
