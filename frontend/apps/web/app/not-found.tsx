import {XStack, YStack} from "@tamagui/stacks";
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
          <XStack alignItems="center" gap="$3">
            <SizableText size="$10">☹️</SizableText>
            <SizableText size="$8" fontWeight="bold">
              Document Not Found
            </SizableText>
          </XStack>
          <YStack gap="$3">
            <SizableText>
              Oops! The document you're looking for doesn't seem to exist. It
              may have been moved, deleted, or the link might be incorrect.
            </SizableText>
            <SizableText>
              Please double-check the URL or head back to the dashboard to find
              what you're looking for. If you need help, feel free to reach out
              to support.
            </SizableText>
          </YStack>
        </YStack>
      </Container>
    </YStack>
  );
}
