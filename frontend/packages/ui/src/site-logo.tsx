import {
  getFileUrl,
  HMMetadata,
  UnpackedHypermediaId,
  useRouteLink,
} from "@shm/shared";
import {Image} from "@tamagui/image";
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
      <XStack {...homeLinkProps} maxHeight={60} flex={1}>
        <Image
          height={60}
          flex={1}
          source={{uri: getFileUrl(metadata.seedExperimentalLogo)}}
          resizeMode="contain"
        />
      </XStack>
    );
  }
  return (
    <XStack {...homeLinkProps}>
      <HMIcon size={24} id={id} metadata={metadata} />
      <SizableText size="$4" fontWeight="bold">
        {metadata?.name}
      </SizableText>
    </XStack>
  );
}
