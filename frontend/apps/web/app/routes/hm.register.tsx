import {YStack} from "@tamagui/stacks";
import {Heading} from "@tamagui/text";

export const loader = async ({request}: {request: Request}) => {
  return null;
};

export default function RegisterPage() {
  return (
    <YStack>
      <Heading>Paste this URL into the app</Heading>
    </YStack>
  );
}
