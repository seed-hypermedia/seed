import {createHMUrl, UnpackedHypermediaId} from "@shm/shared";
import {Container} from "@shm/ui/container";
import {Button, ButtonText} from "@tamagui/button";
import {ExternalLink} from "@tamagui/lucide-icons";
import {XStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {WebIdentityFooter} from "./client-lazy";

export function PageFooter({
  id,
  enableWebSigning,
}: {
  id?: UnpackedHypermediaId;
  enableWebSigning?: boolean;
}) {
  return (
    <Container>
      <XStack padding="$4" gap="$4" ai="center">
        <SizableText size="$1">
          Powered by{" "}
          <ButtonText
            size="$1"
            tag="a"
            href="https://seed.hyper.media"
            target="_blank"
          >
            Seed Hypermedia
          </ButtonText>
        </SizableText>
        {id ? (
          <Button
            tag="a"
            size="$1"
            href={createHMUrl(id)}
            style={{textDecoration: "none"}}
            icon={ExternalLink}
            backgroundColor="$green9"
            hoverStyle={{backgroundColor: "$green8"}}
            themeInverse
            padding="$3"
          >
            Open App
          </Button>
        ) : null}
      </XStack>
      {enableWebSigning ? <WebIdentityFooter /> : null}
    </Container>
  );
}
