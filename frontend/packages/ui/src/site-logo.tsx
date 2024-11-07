import {
  getFileUrl,
  HMMetadata,
  UnpackedHypermediaId,
  useRouteLink,
} from "@shm/shared";
import {View} from "@tamagui/core";
import {XStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {HMIcon} from "./hm-icon";

export function SiteLogo({
  id,
  metadata,
}: {
  id: UnpackedHypermediaId;
  metadata?: HMMetadata | null;
}) {
  const homeLinkProps = useRouteLink({
    key: "document",
    id,
  });
  if (metadata?.seedExperimentalLogo) {
    return (
      <XStack {...homeLinkProps} height={60} flex={1} ai="center" jc="center">
        <img
          src={getFileUrl(metadata.seedExperimentalLogo)}
          height={60}
          style={{objectFit: "contain"}}
        />
      </XStack>
    );
  }
  return (
    <View
      {...homeLinkProps}
      flex={1}
      ai="center"
      jc="center"
      gap="$2"
      flexDirection="column"
      $gtSm={{flexDirection: "row"}}
    >
      <HMIcon size={24} id={id} metadata={metadata} />
      <SizableText
        size="$4"
        fontWeight="bold"
        textAlign="center"
        $gtSm={{textAlign: "left"}}
      >
        {metadata?.name}
      </SizableText>
    </View>
  );
}
