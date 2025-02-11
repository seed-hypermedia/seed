import {createHMUrl, UnpackedHypermediaId} from "@shm/shared";
import {ExternalLink} from "@shm/ui";
import {Container} from "@shm/ui/src/container";
import {Button, ButtonText} from "@tamagui/button";
import {XStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";

export function PageFooter({id}: {id?: UnpackedHypermediaId}) {
  return (
    <Container>
      <XStack padding="$4" gap="$4" ai="center">
        <SizableText size="$1">
          Powered by{" "}
          <ButtonText
            size="$1"
            tag="a"
            href="https://seedhypermedia.com"
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
    </Container>
  );
}
