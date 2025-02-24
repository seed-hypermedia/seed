import {HMMetadata, UnpackedHypermediaId, useRouteLink} from "@shm/shared";
import {useImageUrl} from "@shm/ui/get-file-url";
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
    <XStack {...homeLinkProps} ai="center" jc="center" gap="$2">
      <HMIcon size={24} id={id} metadata={metadata} />
      <SizableText
        userSelect="none"
        size="$4"
        fontWeight="bold"
        textAlign="center"
        $gtSm={{textAlign: "left"}}
      >
        {metadata?.name}
      </SizableText>
    </XStack>
  );
}
