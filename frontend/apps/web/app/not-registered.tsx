import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {SiteDocumentPayload} from "./loaders";
import {Container} from "./ui/container";

export function NotRegisteredPage({homeMetadata, homeId}: SiteDocumentPayload) {
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
            <SizableText size="$10">🚧</SizableText>
            <SizableText size="$8" fontWeight="bold">
              Seed site Setup In Progress
            </SizableText>
          </XStack>
          <YStack gap="$3">
            <SizableText>
              Welcome! We're excited to have you onboard. It looks like your
              domain is not yet fully registered in our system. Don't
              worry—you're almost there!
            </SizableText>
            <SizableText>
              To complete your setup, please follow the remaining steps in your
              account settings. Once done, your domain will be live and ready to
              go. Thank you for your patience!
            </SizableText>
          </YStack>
        </YStack>
      </Container>
    </YStack>
  );
}
