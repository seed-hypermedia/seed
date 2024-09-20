import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {Container} from "../ui/container";

export const loader = async ({request}: {request: Request}) => {
  return null;
};

export default function RegisterPage() {
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
            <SizableText size="$10">🔜</SizableText>
            <SizableText size="$8" fontWeight="bold">
              Site Registration is almost done
            </SizableText>
          </XStack>
          <YStack gap="$3">
            <SizableText>
              To complete the setup, you'll need to add this URL to the register
              input for your publication in the desktop app. This will allow
              this site to start hosting your publication's content and ensure
              everything runs smoothly.
            </SizableText>
            <SizableText>
              Simply copy the URL above and paste it into the designated field
              in your app's publication register settings. If you run into any
              issues, feel free to consult the documentation or reach out to our
              support team.
            </SizableText>
          </YStack>
        </YStack>
      </Container>
    </YStack>
  );
}
