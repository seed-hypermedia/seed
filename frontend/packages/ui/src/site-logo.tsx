import {HMMetadata, UnpackedHypermediaId, useRouteLink} from "@shm/shared";
import {useImageUrl} from "@shm/ui/src/get-file-url";
import {View} from "@tamagui/core";
import {XStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {HMIcon} from "./hm-icon";

export function SiteLogo({
  id,
  metadata,
  isCenterLayout = false,
}: {
  id: UnpackedHypermediaId;
  metadata?: HMMetadata | null;
  isCenterLayout?: boolean;
}) {
  const imageUrl = useImageUrl();
  const homeLinkProps = useRouteLink({
    key: "document",
    id,
  });
  if (metadata?.seedExperimentalLogo) {
    return (
      <XStack
        {...homeLinkProps}
        height={60}
        ai="center"
        jc="center"
        $gtSm={{
          flex: 0,
        }}
      >
        <img
          src={imageUrl(metadata.seedExperimentalLogo, "M")}
          height={60}
          style={{objectFit: "contain"}}
        />
      </XStack>
    );
  }
  return (
    <View
      {...homeLinkProps}
      ai="center"
      jc="center"
      gap="$2"
      flexDirection={isCenterLayout ? "column" : "row"}
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
