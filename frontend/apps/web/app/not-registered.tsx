import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {Container} from "./ui/container";

export function NotRegisteredPage({}: {}) {
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
              Seed Hypermedia Site Coming Soon
            </SizableText>
          </XStack>
          <YStack gap="$3">
            <SizableText>
              Welcome! We're excited to have you onboard. It looks like your
              content has not been published to this new site.
            </SizableText>
            <SizableText>
              To complete your setup, please follow the remaining steps from
              your secret setup URL. Reach out to the Seed Hypermedia team if
              you need any help.
            </SizableText>
          </YStack>
        </YStack>
      </Container>
    </YStack>
  );
}
